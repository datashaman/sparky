import json
import logging

from sparky.models import Branch, Bug, BugStatus, ChangeSet, PullRequest, Worktree, HITLEscalation
from sparky.hitl import hitl_gate
from sparky.sdk import run_agent
from sparky.tools import (
    make_update_status_tool,
    make_set_severity_tool,
    make_open_change_set_tool,
)

logger = logging.getLogger("sparky")


async def triage_agent(bug: Bug) -> Bug:
    logger.info("TriageAgent  <- [%s] %s", bug.id, bug.title)

    result: dict = {}

    await run_agent(
        agent_name="TriageAgent",
        system_prompt=(
            "You are a Triage Agent. Analyse the bug report.\n"
            "Call set_severity with appropriate values.\n"
            "Set data_loss_or_security=true if the bug involves data loss or security.\n"
            "Set is_duplicate=true if this looks like a known issue."
        ),
        user_message=(
            f"Bug: {bug.title}\n"
            f"Description: {bug.description}\n"
            f"Environment: {bug.environment}\n"
            f"Project repos: {[r.name for r in bug.project.repos]}"
        ),
        tools=[make_set_severity_tool(result, bug.history)],
        allowed_tools=["mcp__tools__set_severity"],
    )

    if result.get("is_duplicate"):
        bug.status = BugStatus.CLOSED
        bug.history.append("TriageAgent closed as duplicate.")
        return bug

    bug.severity = result.get("severity", "medium")
    bug.priority = result.get("priority", "p2")
    bug.data_loss_or_security = result.get("data_loss_or_security", False)
    bug.is_p0 = bug.priority == "p0"

    if bug.data_loss_or_security or bug.is_p0:
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Triage Review",
            trigger_class="consequence:data-loss-or-security" if bug.data_loss_or_security else "consequence:p0",
            work_item_id=bug.id,
            reason=f"severity={bug.severity} priority={bug.priority} -- human triage confirmation required.",
        ))
        if "reject" in decision.lower():
            bug.status = BugStatus.CLOSED
            return bug

    bug.status = BugStatus.TRIAGED
    return bug


async def bug_coding_agent(bug: Bug) -> Bug:
    logger.info("CodingAgent(bug)  <- [%s] %s", bug.id, bug.title)

    change_set_data: dict = {}
    repo_list = [{"id": r.id, "name": r.name} for r in bug.project.repos]

    await run_agent(
        agent_name="CodingAgent:bug",
        system_prompt=(
            "You are a Coding Agent fixing a bug.\n"
            "1. Call open_change_set with the repo IDs the fix touches.\n"
            "2. Call update_status with 'in_review' when the PR(s) are ready."
        ),
        user_message=(
            f"Fix bug: {bug.title}\n"
            f"Description: {bug.description}\n"
            f"Available repos: {json.dumps(repo_list)}"
        ),
        tools=[
            make_open_change_set_tool(change_set_data, bug.history),
            make_update_status_tool({}, bug.history, "CodingAgent"),
        ],
        allowed_tools=[
            "mcp__tools__open_change_set",
            "mcp__tools__update_status",
        ],
    )

    affected_repo_ids = change_set_data.get("repo_ids", [r.id for r in bug.project.repos])
    branch_prefix = f"fix/{bug.id}"

    worktrees = [
        Worktree(
            id=f"wt-{bug.id}-{rid}",
            repo_id=rid,
            branch=Branch(
                id=f"br-{bug.id}-{rid}", repo_id=rid,
                name=f"{branch_prefix}-{rid}",
                work_item_id=bug.id, work_item_type="bug",
            ),
            path=f"/worktrees/{bug.id}/{rid}",
        )
        for rid in affected_repo_ids
    ]

    cs = ChangeSet(
        id=f"cs-{bug.id}",
        work_item_id=bug.id,
        pull_requests=[
            PullRequest(repo_id=wt.repo_id, branch=wt.branch.name, worktree_id=wt.id)
            for wt in worktrees
        ],
    )
    bug.change_set = cs
    bug.status = BugStatus.IN_REVIEW
    logger.info("  Worktrees: %s", [wt.id for wt in worktrees])
    logger.info("  ChangeSet %s: %d PR(s) across repos %s", cs.id, len(cs.pull_requests), affected_repo_ids)
    return bug


async def bug_review_agent(bug: Bug) -> Bug:
    logger.info("ReviewAgent(bug)  <- [%s]", bug.id)

    result: dict = {}
    pr_summary = (
        [{"repo_id": pr.repo_id, "branch": pr.branch} for pr in bug.change_set.pull_requests]
        if bug.change_set else []
    )

    await run_agent(
        agent_name="ReviewAgent:bug",
        system_prompt=(
            "You are a Review Agent. Review all PRs in the bug fix ChangeSet.\n"
            "Call update_status with 'verified' if all approved, 'in_progress' if any need changes."
        ),
        user_message=f"Review fix PRs for: {bug.title}\nPRs: {json.dumps(pr_summary)}",
        tools=[make_update_status_tool(result, bug.history, "ReviewAgent")],
        allowed_tools=["mcp__tools__update_status"],
    )

    decision = result.get("new_status", "verified")
    if decision == "verified" and bug.change_set:
        for pr in bug.change_set.pull_requests:
            pr.status = "approved"
        bug.change_set.status = "all_approved"

    bug.status = BugStatus(decision)
    return bug


async def bug_release_agent(bug: Bug) -> Bug:
    logger.info("ReleaseAgent(bug)  <- [%s]", bug.id)

    if bug.is_p0:
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Hotfix Deploy Approval",
            trigger_class="mandatory:p0-hotfix-deploy",
            work_item_id=bug.id,
            reason="P0 fix -- mandatory human approval before prod deploy.",
        ))
        if "reject" in decision.lower():
            bug.status = BugStatus.VERIFIED
            return bug

    if bug.change_set:
        for pr in bug.change_set.pull_requests:
            pr.status = "merged"
        bug.change_set.status = "merged"
        repo_ids = [pr.repo_id for pr in bug.change_set.pull_requests]
        branches = [pr.branch for pr in bug.change_set.pull_requests]
        bug.history.append(f"ReleaseAgent deployed fix across repos {repo_ids}.")
        bug.history.append(f"ReleaseAgent cleaned up worktrees and branches: {branches}.")
        logger.info("  [%s] fix deployed across repos: %s", bug.id, repo_ids)
        logger.info("  [%s] worktrees and branches cleaned up: %s", bug.id, branches)

    bug.status = BugStatus.FIXED
    return bug
