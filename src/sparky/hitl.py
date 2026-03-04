import asyncio

from sparky.models import HITLEscalation


async def hitl_gate(escalation: HITLEscalation) -> str:
    """Pause execution and ask a human for a decision."""
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
