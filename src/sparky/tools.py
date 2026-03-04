import json

from claude_agent_sdk import tool


def make_update_status_tool(state: dict, history: list, agent_name: str):
    @tool("update_status", "Update the status of the work item being processed.", {
        "new_status": str,
        "note": str,
    })
    async def update_status(args):
        state["new_status"] = args["new_status"]
        history.append(f"{agent_name} -> {args['new_status']}: {args['note']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return update_status


def make_set_flag_tool(state: dict, history: list):
    @tool("set_flag", "Set a boolean flag on the work item.", {
        "flag": str,
        "value": bool,
        "reason": str,
    })
    async def set_flag(args):
        state[args["flag"]] = args["value"]
        history.append(f"PlanningAgent flagged {args['flag']}={args['value']}: {args['reason']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return set_flag


def make_set_estimate_tool(state: dict, history: list):
    @tool("set_estimate", "Set story points for a story.", {
        "points": int,
        "note": str,
    })
    async def set_estimate(args):
        state["points"] = args["points"]
        history.append(f"PlanningAgent estimated {args['points']} pts: {args['note']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return set_estimate


def make_open_change_set_tool(state: dict, history: list):
    @tool("open_change_set", "Create a ChangeSet by declaring which repos need changes. One PR will be opened per repo.", {
        "repo_ids": list,
        "summary": str,
    })
    async def open_change_set(args):
        state["repo_ids"] = args["repo_ids"]
        state["summary"] = args["summary"]
        history.append(f"CodingAgent opened ChangeSet across repos {args['repo_ids']}: {args['summary']}")
        return {"content": [{"type": "text", "text": f'{{"ok": true, "pr_count": {len(args["repo_ids"])}}}'}]}
    return open_change_set


def make_set_severity_tool(state: dict, history: list):
    @tool("set_severity", "Set severity and priority on a bug.", {
        "severity": str,
        "priority": str,
        "is_duplicate": bool,
        "data_loss_or_security": bool,
        "note": str,
    })
    async def set_severity(args):
        state.update(args)
        history.append(
            f"TriageAgent: severity={args['severity']} priority={args['priority']}: {args['note']}"
        )
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return set_severity


def make_classify_ops_tool(state: dict, history: list):
    @tool("classify_ops", "Classify an ops request: set its category, execution type, and risk level.", {
        "category": str,
        "execution_type": str,
        "risk": str,
        "reasoning": str,
        "is_invalid": bool,
    })
    async def classify_ops(args):
        state.update(args)
        history.append(
            f"OpsTriageAgent: category={args['category']} "
            f"exec={args['execution_type']} risk={args['risk']}: {args['reasoning']}"
        )
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return classify_ops


def make_build_runbook_tool(state: dict, history: list):
    @tool("build_runbook", "Generate a numbered runbook for a human to review and execute.", {
        "steps": list,
        "rollback_steps": list,
    })
    async def build_runbook(args):
        state["steps"] = args["steps"]
        state["rollback_steps"] = args.get("rollback_steps", [])
        history.append(f"OpsPlanningAgent built runbook ({len(args['steps'])} steps).")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return build_runbook


def make_execute_action_tool(state: dict, history: list):
    @tool("execute_action", "Simulate executing a direct operational action.", {
        "action": str,
        "target": str,
        "outcome": str,
    })
    async def execute_action(args):
        state.update(args)
        history.append(f"OpsExecutionAgent: {args['action']} on {args['target']} -> {args['outcome']}")
        return {"content": [{"type": "text", "text": '{"ok": true, "simulated": true}'}]}
    return execute_action


def make_verify_outcome_tool(state: dict, history: list):
    @tool("verify_outcome", "Verify that an operation completed successfully.", {
        "success": bool,
        "observations": str,
    })
    async def verify_outcome(args):
        state["success"] = args["success"]
        state["observations"] = args["observations"]
        history.append(f"OpsVerifyAgent: success={args['success']} -- {args['observations']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return verify_outcome


def make_submit_critique_tool(state: dict, history: list):
    @tool(
        "submit_critique",
        "Submit an advisory critique of the work item. List concrete issues, open questions, and recommendations. The receiving agent will decide how to act on this — it is not a blocker.",
        {
            "issues": list,
            "questions": list,
            "recommendations": list,
            "severity": str,
        },
    )
    async def submit_critique(args):
        state.update(args)
        history.append(
            f"CriticAgent: severity={args['severity']} issues={len(args['issues'])} "
            f"questions={len(args['questions'])} recommendations={len(args['recommendations'])}"
        )
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return submit_critique


def make_mark_substantial_change_tool(state: dict, history: list):
    @tool(
        "mark_substantial_change",
        "Mark that the story is being sent back to backlog with a substantial spec change that meaningfully alters scope, acceptance criteria, or technical approach. This will trigger a fresh SpecCritic pass on next grooming.",
        {
            "reason": str,
        },
    )
    async def mark_substantial_change(args):
        state["substantial_change"] = True
        history.append(f"mark_substantial_change: {args['reason']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return mark_substantial_change


def make_create_worktrees_tool(state: dict, history: list):
    @tool(
        "create_worktrees",
        "Create a worktree (isolated checkout) in each repo that needs changes. Each worktree gets a branch named after the work item. Call this before making any code changes.",
        {
            "repo_ids": list,
            "branch_prefix": str,
        },
    )
    async def create_worktrees(args):
        state["repo_ids"] = args["repo_ids"]
        state["branch_prefix"] = args["branch_prefix"]
        history.append(
            f"create_worktrees: repos={args['repo_ids']} branch_prefix={args['branch_prefix']}"
        )
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return create_worktrees


def make_list_worktrees_tool(state: dict, history: list, worktree_provider):
    @tool(
        "list_worktrees",
        "List all existing worktrees for the given repos. Call this first to detect stale/interrupted WIP before creating new worktrees.",
        {
            "repo_ids": list,
        },
    )
    async def list_worktrees(args):
        existing = worktree_provider(args["repo_ids"])
        state["existing"] = existing
        history.append(f"list_worktrees: repos={args['repo_ids']} found={len(existing)}")
        return {"content": [{"type": "text", "text": json.dumps({"worktrees": existing})}]}
    return list_worktrees


def make_resume_worktree_tool(state: dict, history: list):
    @tool(
        "resume_worktree",
        "Resume an existing stale/interrupted worktree instead of creating a new one.",
        {
            "worktree_id": str,
            "reason": str,
        },
    )
    async def resume_worktree(args):
        state.setdefault("resumed", []).append(args["worktree_id"])
        history.append(f"resume_worktree: worktree_id={args['worktree_id']} reason={args['reason']}")
        return {"content": [{"type": "text", "text": '{"ok": true}'}]}
    return resume_worktree
