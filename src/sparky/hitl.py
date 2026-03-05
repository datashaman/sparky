import asyncio
import logging

from sparky.models import HITLEscalation
from sparky.ui import HITLRequest, current_ticket_id

logger = logging.getLogger(__name__)

# Set by WorkflowApp.on_mount() so hitl_gate can post messages to the app
_workflow_app = None


async def hitl_gate(escalation: HITLEscalation) -> str:
    """Pause execution and ask a human for a decision."""
    try:
        ticket_id = current_ticket_id.get()
    except LookupError:
        ticket_id = None

    if ticket_id is not None and _workflow_app is not None:
        prompt = (
            f"[{escalation.trigger_type}] "
            f"{escalation.work_item_id} — {escalation.trigger_class}\n"
            f"    {escalation.reason}"
        )
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        _workflow_app.post_message(HITLRequest(ticket_id, prompt, future))
        decision = await future
        escalation.resolution = decision
        return decision

    print("\n" + "=" * 60)
    print(f"HUMAN-IN-THE-LOOP  [{escalation.trigger_type}]")
    print(f"    Work item : {escalation.work_item_id}")
    print(f"    Trigger   : {escalation.trigger_class}")
    print(f"    Reason    : {escalation.reason}")
    print("=" * 60)
    decision = await asyncio.to_thread(
        input, "    Decision (approve / reject / note): "
    )
    decision = decision.strip()
    escalation.resolution = decision
    print()
    return decision
