import logging

from sparky.models import (
    OpsRequest, OpsCategory, OpsExecType, OpsRisk, OpsStatus,
    ChangeSet, PullRequest, Runbook, HITLEscalation,
)
from sparky.hitl import hitl_gate
from sparky.sdk import run_agent
from sparky.tools import (
    make_classify_ops_tool,
    make_build_runbook_tool,
    make_execute_action_tool,
    make_verify_outcome_tool,
)

logger = logging.getLogger("sparky")


async def ops_triage_agent(req: OpsRequest) -> OpsRequest:
    logger.info("OpsTriageAgent  <- [%s] %s", req.id, req.title)

    result: dict = {}

    await run_agent(
        agent_name="OpsTriageAgent",
        system_prompt=(
            "You are an Ops Triage Agent. Classify the operational request.\n"
            "Call classify_ops with category, execution_type, risk, and reasoning.\n"
            "Set is_invalid=true if this is a duplicate or nonsensical request."
        ),
        user_message=(
            f"Request: {req.title}\n"
            f"Description: {req.description}\n"
            f"Environment: {req.environment}\n"
            f"Project: {req.project.name}"
        ),
        tools=[make_classify_ops_tool(result, req.history)],
        allowed_tools=["mcp__tools__classify_ops"],
    )

    if result.get("is_invalid"):
        req.status = OpsStatus.CLOSED
        req.history.append("OpsTriageAgent closed as invalid/duplicate.")
        return req

    req.category  = OpsCategory(result.get("category",       "infra_config"))
    req.exec_type = OpsExecType(result.get("execution_type", "direct_action"))
    req.risk      = OpsRisk(result.get("risk",               "low"))
    req.status    = OpsStatus.TRIAGED
    return req


async def ops_planning_agent(req: OpsRequest) -> OpsRequest:
    logger.info("OpsPlanningAgent  <- [%s] path=%s risk=%s", req.id, req.exec_type.value, req.risk.value)

    if req.exec_type == OpsExecType.RUNBOOK:
        result: dict = {}

        await run_agent(
            agent_name="OpsPlanningAgent:runbook",
            system_prompt=(
                "You are an Ops Planning Agent generating a runbook.\n"
                "Call build_runbook with clear, numbered steps and rollback steps."
            ),
            user_message=(
                f"Generate a runbook for: {req.title}\n"
                f"Description: {req.description}\n"
                f"Environment: {req.environment}"
            ),
            tools=[make_build_runbook_tool(result, req.history)],
            allowed_tools=["mcp__tools__build_runbook"],
        )

        req.runbook = Runbook(
            id=f"rb-{req.id}",
            ops_request_id=req.id,
            steps=result.get("steps", []),
        )
        if result.get("rollback_steps"):
            req.runbook.steps.append("--- ROLLBACK STEPS ---")
            req.runbook.steps.extend(result["rollback_steps"])

    elif req.exec_type == OpsExecType.CODE_CHANGE:
        affected_repos = req.project.repos
        req.change_set = ChangeSet(
            id=f"cs-{req.id}",
            work_item_id=req.id,
            pull_requests=[
                PullRequest(repo_id=r.id, branch=f"ops/{req.id}-{r.id}")
                for r in affected_repos
            ],
        )
        req.history.append(
            f"OpsPlanningAgent opened ChangeSet across {len(affected_repos)} repo(s)."
        )
        logger.info(
            "  ChangeSet %s: %d PR(s) -- will follow normal PR flow.",
            req.change_set.id, len(affected_repos),
        )

    req.status = OpsStatus.PLANNED
    return req


async def ops_execution_agent(req: OpsRequest) -> OpsRequest:
    if req.exec_type != OpsExecType.DIRECT_ACTION:
        return req

    logger.info("OpsExecutionAgent  <- [%s] %s", req.id, req.title)

    if req.risk in (OpsRisk.HIGH, OpsRisk.MEDIUM):
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Ops Execution Approval",
            trigger_class=f"consequence:ops-{req.risk.value}-risk",
            work_item_id=req.id,
            reason=f"{req.category.value} direct action in {req.environment} -- risk={req.risk.value}.",
        ))
        if "reject" in decision.lower():
            req.status = OpsStatus.CLOSED
            return req

    result: dict = {}

    await run_agent(
        agent_name="OpsExecutionAgent",
        system_prompt=(
            "You are an Ops Execution Agent. Simulate executing the operational action.\n"
            "Call execute_action describing what you are doing, the target, and expected outcome."
        ),
        user_message=(
            f"Execute: {req.title}\n"
            f"Description: {req.description}\n"
            f"Environment: {req.environment}"
        ),
        tools=[make_execute_action_tool(result, req.history)],
        allowed_tools=["mcp__tools__execute_action"],
    )

    req.status = OpsStatus.EXECUTING
    return req


async def ops_verify_agent(req: OpsRequest) -> OpsRequest:
    if req.exec_type == OpsExecType.RUNBOOK:
        pass  # Runbook was executed by a human; verification still happens
    elif req.exec_type == OpsExecType.CODE_CHANGE:
        req.status = OpsStatus.DONE
        return req

    logger.info("OpsVerifyAgent  <- [%s] %s", req.id, req.title)

    result: dict = {}

    await run_agent(
        agent_name="OpsVerifyAgent",
        system_prompt=(
            "You are an Ops Verification Agent.\n"
            "Call verify_outcome with success=true if the operation completed as expected, "
            "false if something looks wrong."
        ),
        user_message=(
            f"Verify outcome of: {req.title}\n"
            f"Description: {req.description}\n"
            f"Environment: {req.environment}"
        ),
        tools=[make_verify_outcome_tool(result, req.history)],
        allowed_tools=["mcp__tools__verify_outcome"],
    )

    if not result.get("success", True):
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Ops Failure Review",
            trigger_class="consequence:ops-unexpected-outcome",
            work_item_id=req.id,
            reason=f"Unexpected outcome: {result.get('observations', 'unknown')}",
        ))
        if "rollback" in decision.lower():
            req.history.append("Human initiated rollback.")
            req.status = OpsStatus.EXECUTING
            return req

    req.status = OpsStatus.DONE
    return req
