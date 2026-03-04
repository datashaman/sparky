import logging

from sparky.models import Bug, BugStatus, HITLEscalation
from sparky.hitl import hitl_gate
from sparky.agents.bug import (
    triage_agent,
    bug_coding_agent,
    bug_review_agent,
    bug_release_agent,
)

logger = logging.getLogger("sparky")


async def run_bug_workflow(bug: Bug) -> Bug:
    logger.info("=" * 60)
    logger.info("Bug workflow: [%s] %s", bug.id, bug.title)
    logger.info("    Project: %s  |  Repos: %s", bug.project.name, [r.name for r in bug.project.repos])
    logger.info("=" * 60)

    bug = await triage_agent(bug)
    if bug.status == BugStatus.CLOSED:
        return bug

    if bug.is_p0:
        decision = await hitl_gate(HITLEscalation(
            trigger_type="P0 Sign-off",
            trigger_class="mandatory:p0",
            work_item_id=bug.id,
            reason="P0 bug -- mandatory human approval before fix begins.",
        ))
        if "reject" in decision.lower():
            bug.status = BugStatus.CLOSED
            return bug

    bug.status = BugStatus.IN_PROGRESS
    bug = await bug_coding_agent(bug)
    bug = await bug_review_agent(bug)
    bug = await bug_release_agent(bug)

    return bug
