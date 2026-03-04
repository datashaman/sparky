import logging

from sparky.models import OpsRequest, OpsExecType, OpsStatus, HITLEscalation
from sparky.hitl import hitl_gate
from sparky.agents.ops import (
    ops_triage_agent,
    ops_planning_agent,
    ops_execution_agent,
    ops_verify_agent,
)

logger = logging.getLogger("sparky")


async def run_ops_workflow(req: OpsRequest) -> OpsRequest:
    logger.info("=" * 60)
    logger.info("Ops workflow: [%s] %s", req.id, req.title)
    logger.info("    Project: %s  |  Env: %s", req.project.name, req.environment)
    logger.info("=" * 60)

    req = await ops_triage_agent(req)
    if req.status == OpsStatus.CLOSED:
        return req

    req = await ops_planning_agent(req)

    if req.exec_type == OpsExecType.RUNBOOK:
        logger.info("Runbook for [%s]:", req.id)
        for i, step in enumerate(req.runbook.steps, 1):
            logger.info("  %d. %s", i, step)
        decision = await hitl_gate(HITLEscalation(
            trigger_type="Runbook Review + Execution",
            trigger_class="mandatory:runbook",
            work_item_id=req.id,
            reason="Runbook requires human review and manual execution.",
        ))
        if "reject" in decision.lower():
            req.status = OpsStatus.CLOSED
            return req
        req.runbook.status = "executed"
        req.status = OpsStatus.EXECUTING

    elif req.exec_type == OpsExecType.CODE_CHANGE:
        req.history.append("OpsRequest routed to PR flow via ChangeSet.")
        req.status = OpsStatus.EXECUTING

    else:
        req = await ops_execution_agent(req)
        if req.status == OpsStatus.CLOSED:
            return req

    req = await ops_verify_agent(req)
    return req
