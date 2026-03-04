import logging

from sparky.models import Story, StoryStatus
from sparky.agents.story import (
    spec_critic_agent,
    design_critic_agent,
    planning_agent,
    coding_agent,
    review_agent,
    test_agent,
    release_agent,
)

logger = logging.getLogger("sparky")


async def run_story_workflow(story: Story) -> Story:
    logger.info("=" * 60)
    logger.info("Story workflow: [%s] %s", story.id, story.title)
    logger.info("    Project: %s  |  Repos: %s", story.project.name, [r.name for r in story.project.repos])
    logger.info("=" * 60)

    # Grooming loop: re-run SpecCritic if story returns with substantial change
    spec_critique = None
    MAX_GROOMING_CYCLES = 3

    for grooming_cycle in range(MAX_GROOMING_CYCLES):
        if grooming_cycle == 0 or story.substantial_change:
            if grooming_cycle > 0:
                logger.info(
                    "Re-running SpecCriticAgent (substantial change on revision #%d)",
                    story.spec_revision_count,
                )
            spec_critique = await spec_critic_agent(story)
            story.substantial_change = False

        story = await planning_agent(story, spec_critique=spec_critique)

        if story.status == StoryStatus.CLOSED:
            return story

        if story.status == StoryStatus.BACKLOG:
            if not story.substantial_change:
                # Spec unchanged — re-grooming would produce the same result
                logger.warning(
                    "Story sent back to backlog without substantial change -- closing as unrefined."
                )
                story.history.append(
                    "PlanningAgent returned story to backlog without spec changes -- closed."
                )
                story.status = StoryStatus.CLOSED
                return story
            logger.info(
                "Story returned to backlog (revision #%d) -- substantial change flagged, will re-critique",
                story.spec_revision_count,
            )
            continue

        break
    else:
        story.history.append(
            f"Story exceeded {MAX_GROOMING_CYCLES} grooming cycles without approval -- closed."
        )
        story.status = StoryStatus.CLOSED
        return story

    story.status = StoryStatus.IN_SPRINT

    # Development loop: re-run DesignCritic every time coding returns from review
    design_critique = None
    MAX_DEV_ITERATIONS = 3

    for dev_iteration in range(MAX_DEV_ITERATIONS):
        if dev_iteration == 0:
            design_critique = await design_critic_agent(
                story,
                critique_context="; ".join(
                    (spec_critique.issues if spec_critique else [])
                    + (spec_critique.questions if spec_critique else [])
                ),
            )
        else:
            logger.info("Re-running DesignCriticAgent (dev iteration #%d)", dev_iteration + 1)
            design_critique = await design_critic_agent(story)

        story.dev_iteration_count = dev_iteration
        story = await coding_agent(story, design_critique=design_critique)
        story = await review_agent(story)

        if story.status == StoryStatus.IN_DEV:
            logger.info("Code review requested changes -- re-evaluating design approach")
            story.status = StoryStatus.IN_SPRINT
            continue

        break
    else:
        story.history.append(
            f"Story exceeded {MAX_DEV_ITERATIONS} dev iterations without passing review -- flagged."
        )

    if story.status == StoryStatus.IN_QA:
        story = await test_agent(story)

    if story.status == StoryStatus.STAGING:
        story = await release_agent(story)

    return story
