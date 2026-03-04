import json
import logging

from sparky.models import Story, StoryStatus, ChangeSet, PullRequest, Branch, Worktree, Critique, HITLEscalation
from sparky.hitl import hitl_gate
from sparky.sdk import run_agent
from sparky.tools import (
    make_update_status_tool,
    make_set_flag_tool,
    make_set_estimate_tool,
    make_open_change_set_tool,
    make_submit_critique_tool,
    make_mark_substantial_change_tool,
    make_create_worktrees_tool,
    make_list_worktrees_tool,
    make_resume_worktree_tool,
)

logger = logging.getLogger("sparky")


def _simulate_existing_worktrees(repo_ids: list, work_item_id: str) -> list:
    """Stub -- in production, query actual git state for each repo."""
    return []


async def spec_critic_agent(story: Story) -> Critique:
    logger.info("SpecCriticAgent  <- [%s] %s", story.id, story.title)

    result: dict = {}

    await run_agent(
        agent_name="SpecCriticAgent",
        system_prompt=(
            "You are a Spec Critic Agent. Your job is to review story specs for quality "
            "problems BEFORE a planning agent grooms them. Be specific and constructive.\n\n"
            "Look for:\n"
            "- Missing or untestable acceptance criteria\n"
            "- Undefined terms or ambiguous scope\n"
            "- Missing edge cases (error states, empty states, concurrency)\n"
            "- Contradictions or inconsistencies in the description\n"
            "- Scope that belongs in a different story\n"
            "- Implicit assumptions that should be stated explicitly\n\n"
            "Call submit_critique with your findings. Be concise -- bullet points only. "
            "If the spec is clean, say so with severity='clean' and empty lists."
        ),
        user_message=(
            f"Story: {story.title}\n"
            f"Description: {story.description}\n"
            f"Project: {story.project.name}\n"
            f"Repos: {[r.name for r in story.project.repos]}"
        ),
        tools=[make_submit_critique_tool(result, story.history)],
        allowed_tools=["mcp__tools__submit_critique"],
    )

    critique = Critique(
        id=f"crit-spec-{story.id}",
        work_item_id=story.id,
        critic_type="spec",
        issues=result.get("issues", []),
        questions=result.get("questions", []),
        recommendations=result.get("recommendations", []),
        severity=result.get("severity", "advisory"),
    )

    if critique.severity == "clean":
        logger.info("  Spec looks clean -- no issues found.")
    else:
        logger.info(
            "  Spec critique (%s): %d issue(s), %d question(s)",
            critique.severity, len(critique.issues), len(critique.questions),
        )
        for issue in critique.issues:
            logger.info("    - %s", issue)
        for q in critique.questions:
            logger.info("    ? %s", q)

    return critique


async def design_critic_agent(story: Story, critique_context: str = "") -> Critique:
    logger.info("DesignCriticAgent  <- [%s] %s", story.id, story.title)

    result: dict = {}
    repo_list = [{"id": r.id, "name": r.name, "lang": r.primary_language}
                 for r in story.project.repos]

    await run_agent(
        agent_name="DesignCriticAgent",
        system_prompt=(
            "You are a Design Critic Agent. Review the story and its implementation context "
            "BEFORE coding starts. Be specific and constructive.\n\n"
            "Look for:\n"
            "- Over-engineering or unnecessary complexity\n"
            "- Wrong abstraction layer (e.g. business logic leaking into the wrong service)\n"
            "- Missed existing patterns or reusable components in the codebase\n"
            "- Repos that probably shouldn't need changing (scope creep)\n"
            "- Tight coupling that will make future changes harder\n"
            "- Missing considerations: migrations, backwards compatibility, feature flags\n"
            "- Security surface not mentioned in the spec\n\n"
            "Call submit_critique with your findings. Be concise. "
            "If the approach looks solid, say so with severity='clean'."
        ),
        user_message=(
            f"Story: {story.title}\n"
            f"Description: {story.description}\n"
            f"Available repos: {json.dumps(repo_list)}\n"
            f"Has breaking API change: {story.is_breaking_api}\n"
            f"Has security surface: {story.has_security_surface}\n"
            + (f"Spec critique notes: {critique_context}\n" if critique_context else "")
        ),
        tools=[make_submit_critique_tool(result, story.history)],
        allowed_tools=["mcp__tools__submit_critique"],
    )

    critique = Critique(
        id=f"crit-design-{story.id}",
        work_item_id=story.id,
        critic_type="design",
        issues=result.get("issues", []),
        questions=result.get("questions", []),
        recommendations=result.get("recommendations", []),
        severity=result.get("severity", "advisory"),
    )

    if critique.severity == "clean":
        logger.info("  Design looks solid -- no issues found.")
    else:
        logger.info(
            "  Design critique (%s): %d issue(s), %d recommendation(s)",
            critique.severity, len(critique.issues), len(critique.recommendations),
        )
        for issue in critique.issues:
            logger.info("    - %s", issue)
        for rec in critique.recommendations:
            logger.info("    > %s", rec)

    return critique


async def planning_agent(story: Story, spec_critique: Critique | None = None) -> Story:
    """
    Groom and estimate a story -- informed by the SpecCritique -- then scan all
    project repos for stale/interrupted worktrees before finalising the sprint plan.
    """
    logger.info("PlanningAgent  <- [%s] %s", story.id, story.title)
    if spec_critique and spec_critique.severity != "clean":
        logger.info(
            "  Spec critique in context: %s (%d issues, %d questions)",
            spec_critique.severity, len(spec_critique.issues), len(spec_critique.questions),
        )

    # -- Phase 1: groom and estimate ----------------------------------------
    flags: dict = {}
    status_update: dict = {}
    estimate: dict = {}

    repo_names = ", ".join(r.name for r in story.project.repos) or "unknown"

    critique_context = ""
    if spec_critique and spec_critique.severity != "clean":
        critique_context = (
            f"\n\nSpec Critique ({spec_critique.severity}):\n"
            + ("Issues:\n" + "\n".join(f"- {i}" for i in spec_critique.issues) + "\n"
               if spec_critique.issues else "")
            + ("Questions:\n" + "\n".join(f"- {q}" for q in spec_critique.questions) + "\n"
               if spec_critique.questions else "")
            + ("Recommendations:\n" + "\n".join(f"- {r}" for r in spec_critique.recommendations)
               if spec_critique.recommendations else "")
            + "\nConsider these when deciding whether to approve, send back, or reject."
        )

    revision_note = (
        f"\n\nThis is revision #{story.spec_revision_count} of this story."
        if story.spec_revision_count > 0 else ""
    )

    await run_agent(
        agent_name="PlanningAgent:groom",
        system_prompt=(
            "You are a Planning Agent. Analyse the story and:\n"
            "1. Call set_estimate with story points (1-13).\n"
            "2. Call set_flag with cross_team=true if this touches multiple teams.\n"
            "3. Call update_status with 'refined' if approved, 'backlog' if needs more "
            "   work, or 'closed' if rejected.\n"
            "4. If sending back to backlog AND the spec has changed substantially "
            "   (new scope, changed criteria, different technical approach) -- call "
            "   mark_substantial_change with the reason. Skip it for minor clarifications.\n"
            "A spec critique may be included -- factor it in but you are not obligated "
            "to reject solely on that basis. Be concise."
        ),
        user_message=(
            f"Story: {story.title}\n"
            f"Description: {story.description}\n"
            f"Project repos: {repo_names}"
            + critique_context
            + revision_note
        ),
        tools=[
            make_update_status_tool(status_update, story.history, "PlanningAgent"),
            make_set_flag_tool(flags, story.history),
            make_set_estimate_tool(estimate, story.history),
            make_mark_substantial_change_tool(status_update, story.history),
        ],
        allowed_tools=[
            "mcp__tools__update_status",
            "mcp__tools__set_flag",
            "mcp__tools__set_estimate",
            "mcp__tools__mark_substantial_change",
        ],
    )

    if flags.get("cross_team"):
        story.cross_team = True
    if estimate.get("points"):
        story.story_points = estimate["points"]

    new_status = status_update.get("new_status", "refined")

    if status_update.get("substantial_change"):
        story.substantial_change = True

    if new_status == "backlog":
        story.spec_revision_count += 1
        story.status = StoryStatus.BACKLOG
        return story

    if new_status == "closed":
        story.status = StoryStatus.CLOSED
        return story

    if story.cross_team:
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Scope Review",
            trigger_class="consequence:cross-team",
            work_item_id=story.id,
            reason="Story touches multiple teams -- human sign-off required.",
        ))
        if "reject" in decision.lower():
            story.status = StoryStatus.CLOSED
            return story

    # -- Phase 2: pre-sprint worktree scan ----------------------------------
    logger.info("PlanningAgent  scanning worktrees for sprint readiness ...")

    repo_ids = [r.id for r in story.project.repos]
    wt_scan: dict = {}

    def _worktree_provider(queried_repo_ids: list) -> list:
        return _simulate_existing_worktrees(queried_repo_ids, story.id)

    await run_agent(
        agent_name="PlanningAgent:worktree-scan",
        system_prompt=(
            "You are a Planning Agent doing a pre-sprint worktree scan.\n"
            "Call list_worktrees for all repos in the project.\n"
            "Summarise any stale or conflicting WIP that could affect sprint scheduling."
        ),
        user_message=(
            f"Scan repos before scheduling story {story.id} into sprint.\n"
            f"Repos: {json.dumps([{'id': r.id, 'name': r.name} for r in story.project.repos])}"
        ),
        tools=[make_list_worktrees_tool(wt_scan, story.history, _worktree_provider)],
        allowed_tools=["mcp__tools__list_worktrees"],
    )

    existing_wts = wt_scan.get("existing", [])
    conflicts = []
    resumable = []

    for wt in existing_wts:
        if wt["repo_id"] not in repo_ids:
            continue
        if wt["status"] != "stale":
            continue
        if wt["work_item_id"] == story.id:
            resumable.append(wt)
            story.history.append(
                f"PlanningAgent found resumable WIP for this story in "
                f"repo {wt['repo_id']} (worktree {wt['worktree_id']}, "
                f"last active: {wt['last_activity_at']})."
            )
        else:
            conflicts.append(wt)

    if resumable:
        logger.info("  %d resumable worktree(s) noted for CodingAgent.", len(resumable))

    if conflicts:
        conflict_summary = "; ".join(
            f"repo={w['repo_id']} wt={w['worktree_id']} owner={w['work_item_id']} "
            f"last_active={w['last_activity_at']}"
            for w in conflicts
        )
        logger.warning("  Sprint WIP conflict(s): %s", conflict_summary)
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Sprint WIP Review",
            trigger_class="consequence:sprint-wip-conflict",
            work_item_id=story.id,
            reason=(
                f"Stale WIP from other work items found in repos needed by {story.id}:\n"
                f"{conflict_summary}\n"
                "Options: 'resolve' (discard stale WIP and proceed), "
                "'defer' (delay this story until WIP is cleared)."
            ),
        ))
        if "defer" in decision.lower():
            story.history.append(
                "PlanningAgent deferred story -- sprint WIP conflict unresolved."
            )
            story.status = StoryStatus.BACKLOG
            return story
        else:
            story.history.append(
                "Human approved resolving sprint WIP conflicts -- proceeding to schedule."
            )

    story.status = StoryStatus.REFINED
    return story


async def coding_agent(story: Story, design_critique: Critique | None = None) -> Story:
    """
    1. Inspect existing worktrees across all repos.
    2. Resume own stale WIP, flag foreign stale WIP as a HITL conflict.
    3. Create fresh worktrees where needed.
    4. Open a ChangeSet with one PR per worktree.
    """
    logger.info("CodingAgent  <- [%s] %s", story.id, story.title)

    repo_list = [{"id": r.id, "name": r.name} for r in story.project.repos]
    repo_ids = [r.id for r in story.project.repos]

    # -- Step 1: inspect ----------------------------------------------------
    inspect_result: dict = {}

    def _inspect_provider(queried_repo_ids: list) -> list:
        return _simulate_existing_worktrees(queried_repo_ids, story.id)

    await run_agent(
        agent_name="CodingAgent:inspect",
        system_prompt=(
            "You are a Coding Agent. Before doing any work, inspect existing worktrees.\n"
            "Call list_worktrees with all repo IDs for this story.\n"
            "Report stale WIP, conflicts, or clean repos."
        ),
        user_message=f"Story: {story.title}\nRepos: {json.dumps(repo_list)}",
        tools=[make_list_worktrees_tool(inspect_result, story.history, _inspect_provider)],
        allowed_tools=["mcp__tools__list_worktrees"],
    )

    existing_wts = inspect_result.get("existing", [])

    # -- Step 2: classify each repo -----------------------------------------
    worktree_decisions: dict = {}

    for repo_id in repo_ids:
        matches = [w for w in existing_wts if w["repo_id"] == repo_id]
        if not matches:
            worktree_decisions[repo_id] = "create"
            continue

        wt = matches[0]

        if wt["status"] in ("merged", "cleaned_up", "abandoned"):
            worktree_decisions[repo_id] = "create"

        elif wt["work_item_id"] == story.id and wt["status"] == "stale":
            logger.info(
                "  Resuming stale worktree %s in %s (last active: %s)",
                wt["worktree_id"], repo_id, wt["last_activity_at"],
            )
            story.history.append(
                f"CodingAgent resuming interrupted worktree {wt['worktree_id']} "
                f"(reason: {wt['interrupted_reason']}, last activity: {wt['last_activity_at']})"
            )
            worktree_decisions[repo_id] = f"resume:{wt['worktree_id']}:{wt['branch']}"

        elif wt["work_item_id"] != story.id and wt["status"] == "stale":
            logger.warning(
                "  Worktree conflict in %s: stale WIP for %s",
                repo_id, wt["work_item_id"],
            )
            decision = await hitl_gate(HITLEscalation(
                trigger_type="Worktree Conflict",
                trigger_class="consequence:stale-wip-conflict",
                work_item_id=story.id,
                reason=(
                    f"Repo {repo_id} has stale worktree {wt['worktree_id']} "
                    f"belonging to {wt['work_item_id']} "
                    f"(last activity: {wt['last_activity_at']}). "
                    "Options: 'discard' stale WIP and continue, or 'defer' this story."
                ),
            ))
            if "defer" in decision.lower():
                story.history.append(
                    f"Human deferred story until {wt['work_item_id']} worktree is resolved."
                )
                story.status = StoryStatus.IN_DEV
                return story
            else:
                story.history.append(
                    f"Human approved discarding stale worktree {wt['worktree_id']}."
                )
                worktree_decisions[repo_id] = "create"
        else:
            worktree_decisions[repo_id] = "create"

    # -- Step 3: create / resume + open ChangeSet ---------------------------
    create_result: dict = {}
    change_set_data: dict = {}
    resume_result: dict = {}

    to_create = [rid for rid, d in worktree_decisions.items() if d == "create"]
    to_resume = {
        rid: d.split(":")[1]
        for rid, d in worktree_decisions.items()
        if d.startswith("resume:")
    }

    design_critique_context = ""
    if design_critique and design_critique.severity != "clean":
        design_critique_context = (
            f"\n\nDesign Critique ({design_critique.severity}):\n"
            + ("Issues:\n" + "\n".join(f"- {i}" for i in design_critique.issues) + "\n"
               if design_critique.issues else "")
            + ("Recommendations:\n" + "\n".join(f"- {r}" for r in design_critique.recommendations)
               if design_critique.recommendations else "")
            + "\nConsider these when choosing your implementation approach -- they are advisory."
        )
        if design_critique.disposition:
            design_critique_context += f"\nNote: {design_critique.disposition}"

    await run_agent(
        agent_name="CodingAgent:implement",
        system_prompt=(
            "You are a Coding Agent. Execute the worktree plan, then open a ChangeSet.\n"
            f"{'Call create_worktrees for repos: ' + str(to_create) + chr(10) if to_create else ''}"
            f"{'Call resume_worktree for each of: ' + str(list(to_resume.values())) + chr(10) if to_resume else ''}"
            "Then call open_change_set for all affected repos.\n"
            "Finally call update_status with 'in_review', noting any security surface "
            "or breaking API change. A design critique may be included -- it is advisory."
        ),
        user_message=(
            f"Implement: {story.title}\n"
            f"Description: {story.description}\n"
            f"Repos: {json.dumps(repo_list)}\n"
            f"Worktree plan: {worktree_decisions}"
            + design_critique_context
        ),
        tools=[
            make_create_worktrees_tool(create_result, story.history),
            make_resume_worktree_tool(resume_result, story.history),
            make_open_change_set_tool(change_set_data, story.history),
            make_update_status_tool(change_set_data, story.history, "CodingAgent"),
        ],
        allowed_tools=[
            "mcp__tools__create_worktrees",
            "mcp__tools__resume_worktree",
            "mcp__tools__open_change_set",
            "mcp__tools__update_status",
        ],
    )

    # -- Build Worktree / Branch / ChangeSet objects ------------------------
    branch_prefix = create_result.get("branch_prefix", f"feat/{story.id}")
    worktrees = []

    for repo_id, decision in worktree_decisions.items():
        if decision.startswith("resume:"):
            parts = decision.split(":")
            wt_id = parts[1]
            branch_name = parts[2] if len(parts) > 2 else f"feat/{story.id}-{repo_id}"
            wt = Worktree(
                id=wt_id, repo_id=repo_id,
                branch=Branch(
                    id=f"br-{story.id}-{repo_id}", repo_id=repo_id,
                    name=branch_name, work_item_id=story.id, work_item_type="story",
                ),
                path=f"/worktrees/{story.id}/{repo_id}",
                status="active", work_item_id=story.id, work_item_type="story",
            )
        else:
            wt = Worktree(
                id=f"wt-{story.id}-{repo_id}", repo_id=repo_id,
                branch=Branch(
                    id=f"br-{story.id}-{repo_id}", repo_id=repo_id,
                    name=f"{branch_prefix}-{repo_id}",
                    work_item_id=story.id, work_item_type="story",
                ),
                path=f"/worktrees/{story.id}/{repo_id}",
                status="active", work_item_id=story.id, work_item_type="story",
            )
        worktrees.append(wt)

    cs = ChangeSet(
        id=f"cs-{story.id}",
        work_item_id=story.id,
        pull_requests=[
            PullRequest(repo_id=wt.repo_id, branch=wt.branch.name, worktree_id=wt.id)
            for wt in worktrees
        ],
    )
    story.change_set = cs
    story.has_security_surface = "security" in change_set_data.get("note", "").lower()
    story.is_breaking_api = "breaking" in change_set_data.get("note", "").lower()
    story.status = StoryStatus.IN_REVIEW

    resumed = [wt.id for wt in worktrees if worktree_decisions[wt.repo_id].startswith("resume:")]
    created = [wt.id for wt in worktrees if worktree_decisions[wt.repo_id] == "create"]
    if resumed:
        logger.info("  Resumed worktrees: %s", resumed)
    if created:
        logger.info("  Created worktrees: %s", created)
    logger.info("  ChangeSet %s: %d PR(s) across repos %s", cs.id, len(cs.pull_requests), list(worktree_decisions.keys()))
    return story


async def review_agent(story: Story) -> Story:
    logger.info("ReviewAgent  <- [%s] ChangeSet %s", story.id, story.change_set.id if story.change_set else "none")

    result: dict = {}
    pr_summary = (
        [{"repo_id": pr.repo_id, "branch": pr.branch} for pr in story.change_set.pull_requests]
        if story.change_set else []
    )

    await run_agent(
        agent_name="ReviewAgent",
        system_prompt=(
            "You are a Review Agent. Review all PRs in the ChangeSet.\n"
            "Call update_status with 'in_qa' if all PRs are approved, "
            "or 'in_dev' if any PR needs changes."
        ),
        user_message=(
            f"Review ChangeSet for: {story.title}\n"
            f"PRs: {json.dumps(pr_summary)}\n"
            f"Has security surface: {story.has_security_surface}\n"
            f"Is breaking API: {story.is_breaking_api}"
        ),
        tools=[make_update_status_tool(result, story.history, "ReviewAgent")],
        allowed_tools=["mcp__tools__update_status"],
    )

    if story.has_security_surface or story.is_breaking_api:
        reason = []
        if story.has_security_surface:
            reason.append("security surface detected")
        if story.is_breaking_api:
            reason.append("breaking API change")
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Code Review",
            trigger_class="consequence:security" if story.has_security_surface else "consequence:breaking-api",
            work_item_id=story.id,
            reason=", ".join(reason) + f" (across {len(pr_summary)} repo(s))",
        ))
        if "reject" in decision.lower():
            story.status = StoryStatus.IN_DEV
            return story

    decision = result.get("new_status", "in_qa")
    if decision == "in_qa" and story.change_set:
        for pr in story.change_set.pull_requests:
            pr.status = "approved"
        story.change_set.status = "all_approved"

    story.status = StoryStatus(decision)
    return story


async def test_agent(story: Story) -> Story:
    logger.info("TestAgent  <- [%s] %s", story.id, story.title)

    result: dict = {}

    await run_agent(
        agent_name="TestAgent",
        system_prompt=(
            "You are a Test Agent. Run integration tests across all repos in the ChangeSet.\n"
            "Call update_status with 'staging' if tests pass, 'in_dev' if regression found.\n"
            "Note 'major version' in the note if this is a major release."
        ),
        user_message=f"QA for: {story.title}\n{story.description}",
        tools=[make_update_status_tool(result, story.history, "TestAgent")],
        allowed_tools=["mcp__tools__update_status"],
    )

    if "major" in result.get("note", "").lower():
        story.is_major_version = True

    story.status = StoryStatus(result.get("new_status", "staging"))
    return story


async def release_agent(story: Story) -> Story:
    logger.info("ReleaseAgent  <- [%s] %s", story.id, story.title)

    if story.is_major_version:
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Release Approval",
            trigger_class="consequence:major-version",
            work_item_id=story.id,
            reason="Major version -- human release approval required.",
        ))
        if "reject" in decision.lower():
            story.status = StoryStatus.STAGING
            return story

    if story.change_set:
        for pr in story.change_set.pull_requests:
            pr.status = "merged"
        story.change_set.status = "merged"
        repo_ids = [pr.repo_id for pr in story.change_set.pull_requests]
        branches = [pr.branch for pr in story.change_set.pull_requests]
        story.history.append(f"ReleaseAgent merged and deployed repos {repo_ids}.")
        story.history.append(f"ReleaseAgent cleaned up worktrees and branches: {branches}.")
        logger.info("  [%s] deployed across repos: %s", story.id, repo_ids)
        logger.info("  Worktrees and branches cleaned up: %s", branches)

    story.status = StoryStatus.DONE
    return story
