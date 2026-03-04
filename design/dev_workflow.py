"""
dev_workflow.py
---------------
Minimal implementation of the AI-agent software development workflow.

Agents:  PlanningAgent · CodingAgent · ReviewAgent · TestAgent
         TriageAgent · ReleaseAgent

Key model:
  - A Project contains multiple Repos.
  - A Story or Bug belongs to a Project.
  - Implementation is captured as a ChangeSet — one PR per affected Repo —
    so a single story or fix can span multiple repos atomically.
  - All PRs in a ChangeSet must be approved before moving to QA/verification.

HITL gates fire on *consequence*, not confidence:
  ⚠️  cross-team / strategic / security / breaking-API  → pause for human
  🔴  P0 sign-off and hotfix deploy                     → always pause

Usage:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-...
    python dev_workflow.py
"""

import json
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Repo:
    id: str
    name: str
    url: str = ""
    primary_language: str = ""


@dataclass
class Project:
    id: str
    name: str
    repos: list = field(default_factory=list)  # list[Repo]


@dataclass
class Branch:
    id: str
    repo_id: str
    name: str
    work_item_id: str = ""
    work_item_type: str = ""   # story | bug | ops_request
    base_branch: str = "main"

@dataclass
class Worktree:
    id: str
    repo_id: str
    branch: "Branch" = None
    path: str = ""
    # active | stale | abandoned | merged | cleaned_up
    # stale = has commits, no recent activity (interrupted WIP)
    status: str = "active"
    work_item_id: str = ""
    work_item_type: str = ""   # story | bug | ops_request
    last_activity_at: str = ""
    interrupted_at: str = ""
    interrupted_reason: str = "" 

@dataclass
class PullRequest:
    repo_id: str
    branch: str          # branch name
    worktree_id: str = ""
    status: str = "open"   # open | approved | changes_requested | merged


@dataclass
class ChangeSet:
    """Groups all PRs needed to implement a story or fix across repos."""
    id: str
    work_item_id: str
    pull_requests: list = field(default_factory=list)  # list[PullRequest]
    status: str = "open"   # open | all_approved | merged

    def all_approved(self) -> bool:
        return bool(self.pull_requests) and all(
            pr.status == "approved" for pr in self.pull_requests
        )


class StoryStatus(str, Enum):
    BACKLOG       = "backlog"
    GROOMING      = "grooming"
    REFINED       = "refined"
    IN_SPRINT     = "in_sprint"
    IN_DEV        = "in_dev"
    IN_REVIEW     = "in_review"
    IN_QA         = "in_qa"
    STAGING       = "staging"
    DONE          = "done"
    CLOSED        = "closed"


class BugStatus(str, Enum):
    NEW           = "new"
    TRIAGED       = "triaged"
    IN_SPRINT     = "in_sprint"
    HOTFIX        = "hotfix"
    IN_PROGRESS   = "in_progress"
    IN_REVIEW     = "in_review"
    VERIFIED      = "verified"
    FIXED         = "fixed"
    CLOSED        = "closed"


@dataclass
class Story:
    id: str
    title: str
    description: str
    project: Project = field(default_factory=lambda: Project("p0", "Default"))
    status: StoryStatus = StoryStatus.BACKLOG
    priority: str = "normal"
    story_points: int = 0
    cross_team: bool = False
    has_security_surface: bool = False
    is_breaking_api: bool = False
    is_major_version: bool = False
    change_set: Any = None          # ChangeSet | None
    # Critique tracking
    spec_revision_count: int = 0    # increments each time story returns to backlog
    substantial_change: bool = False  # set by PlanningAgent when spec changed meaningfully
    dev_iteration_count: int = 0    # increments each time story returns to in_dev
    history: list = field(default_factory=list)


@dataclass
class Bug:
    id: str
    title: str
    description: str
    project: Project = field(default_factory=lambda: Project("p0", "Default"))
    environment: str = "production"
    status: BugStatus = BugStatus.NEW
    severity: str = ""
    priority: str = ""
    is_p0: bool = False
    data_loss_or_security: bool = False
    linked_story_id: str = ""
    change_set: Any = None   # ChangeSet | None
    history: list = field(default_factory=list)


@dataclass
class Critique:
    id: str
    work_item_id: str
    critic_type: str            # "spec" | "design"
    issues: list = field(default_factory=list)          # concrete problems found
    questions: list = field(default_factory=list)       # open questions to resolve
    recommendations: list = field(default_factory=list) # suggested improvements
    severity: str = "advisory"  # advisory | significant | blocking (planning agent judges)
    disposition: str = ""       # how the receiving agent responded


@dataclass
class HITLEscalation:
    trigger_type: str
    trigger_class: str          # "consequence:security" | "mandatory:p0" etc.
    work_item_id: str
    reason: str
    resolution: str = ""
    resolved_by: str = "human"


# ---------------------------------------------------------------------------
# HITL gate
# ---------------------------------------------------------------------------

def hitl_gate(escalation: HITLEscalation) -> str:
    """Pause execution and ask a human for a decision."""
    print("\n" + "=" * 60)
    print(f"👤  HUMAN-IN-THE-LOOP  [{escalation.trigger_type}]")
    print(f"    Work item : {escalation.work_item_id}")
    print(f"    Trigger   : {escalation.trigger_class}")
    print(f"    Reason    : {escalation.reason}")
    print("=" * 60)
    decision = input("    Decision (approve / reject / note): ").strip()
    escalation.resolution = decision
    print()
    return decision


# ---------------------------------------------------------------------------
# Base agent helper
# ---------------------------------------------------------------------------

def run_agent(
    system_prompt: str,
    user_message: str,
    tools: list,
    tool_handlers: dict,
) -> str:
    """
    Single agentic loop: call Claude, handle tool_use blocks, return final text.
    """
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1000,
            system=system_prompt,
            tools=tools,
            messages=messages,
        )

        text_parts = []
        tool_calls = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(block)

        if response.stop_reason == "end_turn" or not tool_calls:
            return " ".join(text_parts)

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for call in tool_calls:
            handler = tool_handlers.get(call.name)
            result = handler(call.input) if handler else {"error": "unknown tool"}
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": json.dumps(result),
            })
        messages.append({"role": "user", "content": tool_results})


# ---------------------------------------------------------------------------
# Shared tool definitions
# ---------------------------------------------------------------------------

UPDATE_STATUS_TOOL = {
    "name": "update_status",
    "description": "Update the status of the work item being processed.",
    "input_schema": {
        "type": "object",
        "properties": {
            "new_status": {"type": "string"},
            "note": {"type": "string"},
        },
        "required": ["new_status", "note"],
    },
}

FLAG_TOOL = {
    "name": "set_flag",
    "description": "Set a boolean flag on the work item.",
    "input_schema": {
        "type": "object",
        "properties": {
            "flag": {"type": "string"},
            "value": {"type": "boolean"},
            "reason": {"type": "string"},
        },
        "required": ["flag", "value", "reason"],
    },
}

ESTIMATE_TOOL = {
    "name": "set_estimate",
    "description": "Set story points for a story.",
    "input_schema": {
        "type": "object",
        "properties": {
            "points": {"type": "integer"},
            "note": {"type": "string"},
        },
        "required": ["points", "note"],
    },
}

# Coding agent creates a worktree per affected repo before starting work
CREATE_WORKTREES_TOOL = {
    "name": "create_worktrees",
    "description": (
        "Create a worktree (isolated checkout) in each repo that needs changes. "
        "Each worktree gets a branch named after the work item. "
        "Call this before making any code changes."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "repo_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "IDs of repos needing a worktree.",
            },
            "branch_prefix": {
                "type": "string",
                "description": "Branch name prefix, e.g. 'feat/STORY-42' or 'fix/BUG-99'.",
            },
        },
        "required": ["repo_ids", "branch_prefix"],
    },
}

# Coding agent inspects existing worktrees before creating new ones
LIST_WORKTREES_TOOL = {
    "name": "list_worktrees",
    "description": (
        "List all existing worktrees for the given repos. "
        "Call this first to detect stale/interrupted WIP before creating new worktrees. "
        "Returns worktrees grouped by repo, with status and work_item_id for each."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "repo_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Repo IDs to inspect.",
            },
        },
        "required": ["repo_ids"],
    },
}

RESUME_WORKTREE_TOOL = {
    "name": "resume_worktree",
    "description": (
        "Resume an existing stale/interrupted worktree instead of creating a new one. "
        "Use when a worktree for the current work item already exists with uncommitted "
        "or unpushed work."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "worktree_id": {"type": "string"},
            "reason": {"type": "string", "description": "Why resuming rather than creating fresh."},
        },
        "required": ["worktree_id", "reason"],
    },
}

# Coding agent declares which repos it needs to touch
OPEN_CHANGESET_TOOL = {
    "name": "open_change_set",
    "description": (
        "Create a ChangeSet by declaring which repos need changes. "
        "One PR will be opened per repo."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "repo_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "IDs of repos that need changes.",
            },
            "summary": {"type": "string", "description": "What is being changed and why."},
        },
        "required": ["repo_ids", "summary"],
    },
}


# ---------------------------------------------------------------------------
# Story agents
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Critic tool definitions
# ---------------------------------------------------------------------------

MARK_SUBSTANTIAL_CHANGE_TOOL = {
    "name": "mark_substantial_change",
    "description": (
        "Mark that the story is being sent back to backlog with a substantial spec change "
        "— one that meaningfully alters scope, acceptance criteria, or technical approach. "
        "This will trigger a fresh SpecCritic pass on next grooming. "
        "Do NOT call this for minor clarifications or wording tweaks."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "What changed substantially and why a re-critique is warranted.",
            },
        },
        "required": ["reason"],
    },
}

SUBMIT_CRITIQUE_TOOL = {
    "name": "submit_critique",
    "description": (
        "Submit an advisory critique of the work item. "
        "List concrete issues, open questions, and recommendations. "
        "The receiving agent will decide how to act on this — it is not a blocker."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "issues": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Concrete problems: vague criteria, contradictions, risks.",
            },
            "questions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Open questions the author or planner should resolve.",
            },
            "recommendations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Suggested improvements or alternatives.",
            },
            "severity": {
                "type": "string",
                "enum": ["clean", "advisory", "significant"],
                "description": (
                    "clean=no issues found; "
                    "advisory=minor issues, safe to proceed; "
                    "significant=important issues, planning agent should weigh carefully."
                ),
            },
        },
        "required": ["issues", "questions", "recommendations", "severity"],
    },
}


# ---------------------------------------------------------------------------
# Spec Critic Agent  (runs before PlanningAgent grooms)
# ---------------------------------------------------------------------------

def spec_critic_agent(story: Story) -> Critique:
    """
    Reviews the raw story spec for quality issues before grooming.
    Advisory only — PlanningAgent decides what to do with the output.
    Checks: vague acceptance criteria, missing edge cases, undefined terms,
    contradictions with stated context, scope creep.
    """
    print(f"\n🤖  SpecCriticAgent  ← [{story.id}] {story.title}")

    result: dict = {}

    def handle_submit_critique(inp):
        result.update(inp)
        story.history.append(
            f"SpecCriticAgent: severity={inp['severity']} "
            f"issues={len(inp['issues'])} questions={len(inp['questions'])}"
        )
        return {"ok": True}

    run_agent(
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
            "Call submit_critique with your findings. Be concise — bullet points only. "
            "If the spec is clean, say so with severity='clean' and empty lists."
        ),
        user_message=(
            f"Story: {story.title}\n"
            f"Description: {story.description}\n"
            f"Project: {story.project.name}\n"
            f"Repos: {[r.name for r in story.project.repos]}"
        ),
        tools=[SUBMIT_CRITIQUE_TOOL],
        tool_handlers={"submit_critique": handle_submit_critique},
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
        print(f"   ✅  Spec looks clean — no issues found.")
    else:
        print(f"   📋  Spec critique ({critique.severity}): "
              f"{len(critique.issues)} issue(s), {len(critique.questions)} question(s)")
        for issue in critique.issues:
            print(f"      ⚠ {issue}")
        for q in critique.questions:
            print(f"      ❓ {q}")

    return critique


# ---------------------------------------------------------------------------
# Design Critic Agent  (runs before CodingAgent starts)
# ---------------------------------------------------------------------------

def design_critic_agent(story: Story, critique_context: str = "") -> Critique:
    """
    Reviews the proposed implementation approach before coding begins.
    Advisory only — CodingAgent receives the critique as context and adjusts
    its approach if warranted.
    Checks: over-engineering, wrong abstraction layer, missed existing patterns,
    repo scope (is this the right repo?), coupling risks.
    """
    print(f"\n🤖  DesignCriticAgent  ← [{story.id}] {story.title}")

    result: dict = {}

    def handle_submit_critique(inp):
        result.update(inp)
        story.history.append(
            f"DesignCriticAgent: severity={inp['severity']} "
            f"issues={len(inp['issues'])} recommendations={len(inp['recommendations'])}"
        )
        return {"ok": True}

    repo_list = [{"id": r.id, "name": r.name, "lang": r.primary_language}
                 for r in story.project.repos]

    run_agent(
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
        tools=[SUBMIT_CRITIQUE_TOOL],
        tool_handlers={"submit_critique": handle_submit_critique},
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
        print(f"   ✅  Design looks solid — no issues found.")
    else:
        print(f"   📐  Design critique ({critique.severity}): "
              f"{len(critique.issues)} issue(s), {len(critique.recommendations)} recommendation(s)")
        for issue in critique.issues:
            print(f"      ⚠ {issue}")
        for rec in critique.recommendations:
            print(f"      💡 {rec}")

    return critique



def planning_agent(story: Story, spec_critique: Critique = None) -> Story:
    """
    Groom and estimate a story — informed by the SpecCritique — then scan all
    project repos for stale/interrupted worktrees before finalising the sprint plan.
    """
    print(f"\n🤖  PlanningAgent  ← [{story.id}] {story.title}")
    if spec_critique and spec_critique.severity != "clean":
        print(f"   📋  Spec critique in context: {spec_critique.severity} "
              f"({len(spec_critique.issues)} issues, {len(spec_critique.questions)} questions)")

    flags: dict = {}
    status_update: dict = {}
    estimate: dict = {}

    def handle_set_flag(inp):
        flags[inp["flag"]] = inp["value"]
        story.history.append(
            f"PlanningAgent flagged {inp['flag']}={inp['value']}: {inp['reason']}"
        )
        return {"ok": True}

    def handle_update_status(inp):
        status_update["new_status"] = inp["new_status"]
        story.history.append(f"PlanningAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

    def handle_mark_substantial_change(inp):
        status_update["substantial_change"] = True
        story.history.append(
            f"PlanningAgent marked substantial change: {inp['reason']}"
        )
        return {"ok": True}

    def handle_set_estimate(inp):
        estimate["points"] = inp["points"]
        story.history.append(
            f"PlanningAgent estimated {inp['points']} pts: {inp['note']}"
        )
        return {"ok": True}

    repo_names = ", ".join(r.name for r in story.project.repos) or "unknown"

    # Build critique context string to pass into the grooming prompt
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

    is_revision = story.spec_revision_count > 0
    revision_note = (
        f"\n\nThis is revision #{story.spec_revision_count} of this story."
        if is_revision else ""
    )

    # ── Phase 1: groom and estimate ──────────────────────────────────────────
    run_agent(
        system_prompt=(
            "You are a Planning Agent. Analyse the story and:\n"
            "1. Call set_estimate with story points (1-13).\n"
            "2. Call set_flag with cross_team=true if this touches multiple teams.\n"
            "3. Call update_status with 'refined' if approved, 'backlog' if needs more "
            "   work, or 'closed' if rejected.\n"
            "4. If sending back to backlog AND the spec has changed substantially "
            "   (new scope, changed criteria, different technical approach) — call "
            "   mark_substantial_change with the reason. Skip it for minor clarifications.\n"
            "A spec critique may be included — factor it in but you are not obligated "
            "to reject solely on that basis. Be concise."
        ),
        user_message=(
            f"Story: {story.title}\n"
            f"Description: {story.description}\n"
            f"Project repos: {repo_names}"
            + critique_context
            + revision_note
        ),
        tools=[UPDATE_STATUS_TOOL, FLAG_TOOL, ESTIMATE_TOOL, MARK_SUBSTANTIAL_CHANGE_TOOL],
        tool_handlers={
            "set_flag":                handle_set_flag,
            "update_status":           handle_update_status,
            "set_estimate":            handle_set_estimate,
            "mark_substantial_change": handle_mark_substantial_change,
        },
    )

    if flags.get("cross_team"):
        story.cross_team = True
    if estimate.get("points"):
        story.story_points = estimate["points"]

    new_status = status_update.get("new_status", "refined")

    # Record substantial change flag for orchestrator to act on
    if status_update.get("substantial_change"):
        story.substantial_change = True

    if new_status == "backlog":
        # Returning for more work — increment revision counter
        story.spec_revision_count += 1
        story.status = StoryStatus.BACKLOG
        return story

    if new_status == "closed":
        story.status = StoryStatus.CLOSED
        return story

    # ⚠️ HITL: cross-team or strategic scope
    if story.cross_team:
        decision = hitl_gate(HITLEscalation(
            trigger_type="Scope Review",
            trigger_class="consequence:cross-team",
            work_item_id=story.id,
            reason="Story touches multiple teams — human sign-off required.",
        ))
        if "reject" in decision.lower():
            story.status = StoryStatus.CLOSED
            return story

    # ── Phase 2: pre-sprint worktree scan ────────────────────────────────────
    print(f"\n🤖  PlanningAgent  scanning worktrees for sprint readiness ...")

    repo_ids = [r.id for r in story.project.repos]
    wt_scan: dict = {}

    def handle_list_worktrees(inp):
        # Reuse the same simulation; in prod, query actual git state
        existing = _simulate_existing_worktrees(inp["repo_ids"], story.id)
        wt_scan["existing"] = existing
        story.history.append(
            f"PlanningAgent scanned worktrees in {inp['repo_ids']}: "
            f"found {len(existing)} existing."
        )
        return {"worktrees": existing}

    run_agent(
        system_prompt=(
            "You are a Planning Agent doing a pre-sprint worktree scan.\n"
            "Call list_worktrees for all repos in the project.\n"
            "Summarise any stale or conflicting WIP that could affect sprint scheduling."
        ),
        user_message=(
            f"Scan repos before scheduling story {story.id} into sprint.\n"
            f"Repos: {json.dumps([{'id': r.id, 'name': r.name} for r in story.project.repos])}"
        ),
        tools=[LIST_WORKTREES_TOOL],
        tool_handlers={"list_worktrees": handle_list_worktrees},
    )

    existing_wts = wt_scan.get("existing", [])
    conflicts    = []   # stale WIP for a *different* work item in a repo we need
    resumable    = []   # stale WIP for *this* story — good news, carry it forward

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
        print(f"   ♻️   {len(resumable)} resumable worktree(s) noted for CodingAgent.")

    if conflicts:
        # ⚠️ HITL: foreign stale WIP blocks a sprint repo — surface it now
        conflict_summary = "; ".join(
            f"repo={w['repo_id']} wt={w['worktree_id']} owner={w['work_item_id']} "
            f"last_active={w['last_activity_at']}"
            for w in conflicts
        )
        print(f"   ⚠️   Sprint WIP conflict(s): {conflict_summary}")
        decision = hitl_gate(HITLEscalation(
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
                "PlanningAgent deferred story — sprint WIP conflict unresolved."
            )
            story.status = StoryStatus.BACKLOG
            return story
        else:
            story.history.append(
                "Human approved resolving sprint WIP conflicts — proceeding to schedule."
            )

    story.status = StoryStatus.REFINED
    return story



def coding_agent(story: Story, design_critique: Critique = None) -> Story:
    """
    1. Inspect existing worktrees across all repos.
    2. Resume own stale WIP, flag foreign stale WIP as a HITL conflict.
    3. Create fresh worktrees where needed.
    4. Open a ChangeSet with one PR per worktree.
    Design critique is passed as advisory context into the implementation prompt.
    """
    print(f"\n🤖  CodingAgent  ← [{story.id}] {story.title}")

    repo_list = [{"id": r.id, "name": r.name} for r in story.project.repos]
    repo_ids  = [r.id for r in story.project.repos]

    # ── Step 1: inspect ──────────────────────────────────────────────────────
    inspect_result: dict = {}

    def handle_list_worktrees(inp):
        existing = _simulate_existing_worktrees(inp["repo_ids"], story.id)
        inspect_result["existing"] = existing
        story.history.append(
            f"CodingAgent inspected worktrees in {inp['repo_ids']}: "
            f"found {len(existing)} existing."
        )
        return {"worktrees": existing}

    run_agent(
        system_prompt=(
            "You are a Coding Agent. Before doing any work, inspect existing worktrees.\n"
            "Call list_worktrees with all repo IDs for this story.\n"
            "Report stale WIP, conflicts, or clean repos."
        ),
        user_message=f"Story: {story.title}\nRepos: {json.dumps(repo_list)}",
        tools=[LIST_WORKTREES_TOOL],  # design critique injected later in implementation step
        tool_handlers={"list_worktrees": handle_list_worktrees},
    )

    existing_wts = inspect_result.get("existing", [])

    # ── Step 2: classify each repo ───────────────────────────────────────────
    # decisions: repo_id → "create" | "resume:<worktree_id>"
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
            # Our own interrupted WIP — resume
            print(f"   ♻️   Resuming stale worktree {wt['worktree_id']} in {repo_id} "
                  f"(last active: {wt['last_activity_at']})")
            story.history.append(
                f"CodingAgent resuming interrupted worktree {wt['worktree_id']} "
                f"(reason: {wt['interrupted_reason']}, last activity: {wt['last_activity_at']})"
            )
            worktree_decisions[repo_id] = f"resume:{wt['worktree_id']}:{wt['branch']}"

        elif wt["work_item_id"] != story.id and wt["status"] == "stale":
            # Foreign abandoned WIP — conflict, needs human decision
            print(f"   ⚠️   Worktree conflict in {repo_id}: stale WIP for {wt['work_item_id']}")
            decision = hitl_gate(HITLEscalation(
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
                story.status = StoryStatus.BLOCKED
                return story
            else:
                story.history.append(
                    f"Human approved discarding stale worktree {wt['worktree_id']}."
                )
                worktree_decisions[repo_id] = "create"

        else:
            # Active worktree — shouldn't reach here if planning is correct
            worktree_decisions[repo_id] = "create"

    # ── Step 3: create / resume + open ChangeSet ─────────────────────────────
    create_result: dict = {}
    change_set_data: dict = {}
    resumed_ids: list = []

    def handle_create_worktrees(inp):
        create_result["repo_ids"]      = inp["repo_ids"]
        create_result["branch_prefix"] = inp["branch_prefix"]
        story.history.append(
            f"CodingAgent created worktrees in repos {inp['repo_ids']} "
            f"on branch prefix '{inp['branch_prefix']}'"
        )
        return {"ok": True}

    def handle_resume_worktree(inp):
        resumed_ids.append(inp["worktree_id"])
        story.history.append(
            f"CodingAgent resumed worktree {inp['worktree_id']}: {inp['reason']}"
        )
        return {"ok": True}

    def handle_open_change_set(inp):
        change_set_data["repo_ids"] = inp["repo_ids"]
        change_set_data["summary"]  = inp["summary"]
        story.history.append(
            f"CodingAgent opened ChangeSet across repos {inp['repo_ids']}: {inp['summary']}"
        )
        return {"ok": True}

    def handle_update_status(inp):
        change_set_data["note"]         = inp.get("note", "")
        change_set_data["has_security"] = "security" in inp.get("note", "").lower()
        change_set_data["is_breaking"]  = "breaking" in inp.get("note", "").lower()
        story.history.append(f"CodingAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

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
            + "\nConsider these when choosing your implementation approach — they are advisory."
        )
        if design_critique.disposition:
            design_critique_context += f"\nNote: {design_critique.disposition}"

    run_agent(
        system_prompt=(
            "You are a Coding Agent. Execute the worktree plan, then open a ChangeSet.\n"
            f"{'Call create_worktrees for repos: ' + str(to_create) + chr(10) if to_create else ''}"
            f"{'Call resume_worktree for each of: ' + str(list(to_resume.values())) + chr(10) if to_resume else ''}"
            "Then call open_change_set for all affected repos.\n"
            "Finally call update_status with 'in_review', noting any security surface "
            "or breaking API change. A design critique may be included — it is advisory."
        ),
        user_message=(
            f"Implement: {story.title}\n"
            f"Description: {story.description}\n"
            f"Repos: {json.dumps(repo_list)}\n"
            f"Worktree plan: {worktree_decisions}"
            + design_critique_context
        ),
        tools=[
            CREATE_WORKTREES_TOOL, RESUME_WORKTREE_TOOL,
            OPEN_CHANGESET_TOOL,   UPDATE_STATUS_TOOL,
        ],
        tool_handlers={
            "create_worktrees": handle_create_worktrees,
            "resume_worktree":  handle_resume_worktree,
            "open_change_set":  handle_open_change_set,
            "update_status":    handle_update_status,
        },
    )

    # ── Step 4: build Worktree / Branch / ChangeSet objects ──────────────────
    branch_prefix = create_result.get("branch_prefix", f"feat/{story.id}")
    worktrees     = []

    for repo_id, decision in worktree_decisions.items():
        if decision.startswith("resume:"):
            parts      = decision.split(":")
            wt_id      = parts[1]
            branch_name = parts[2] if len(parts) > 2 else f"feat/{story.id}-{repo_id}"
            wt = Worktree(
                id=wt_id,
                repo_id=repo_id,
                branch=Branch(
                    id=f"br-{story.id}-{repo_id}",
                    repo_id=repo_id,
                    name=branch_name,
                    work_item_id=story.id,
                    work_item_type="story",
                ),
                path=f"/worktrees/{story.id}/{repo_id}",
                status="active",
                work_item_id=story.id,
                work_item_type="story",
            )
        else:
            wt = Worktree(
                id=f"wt-{story.id}-{repo_id}",
                repo_id=repo_id,
                branch=Branch(
                    id=f"br-{story.id}-{repo_id}",
                    repo_id=repo_id,
                    name=f"{branch_prefix}-{repo_id}",
                    work_item_id=story.id,
                    work_item_type="story",
                ),
                path=f"/worktrees/{story.id}/{repo_id}",
                status="active",
                work_item_id=story.id,
                work_item_type="story",
            )
        worktrees.append(wt)

    cs = ChangeSet(
        id=f"cs-{story.id}",
        work_item_id=story.id,
        pull_requests=[
            PullRequest(
                repo_id=wt.repo_id,
                branch=wt.branch.name,
                worktree_id=wt.id,
            )
            for wt in worktrees
        ],
    )
    story.change_set           = cs
    story.has_security_surface = change_set_data.get("has_security", False)
    story.is_breaking_api      = change_set_data.get("is_breaking", False)
    story.status               = StoryStatus.IN_REVIEW

    resumed = [wt.id for wt in worktrees if worktree_decisions[wt.repo_id].startswith("resume:")]
    created = [wt.id for wt in worktrees if worktree_decisions[wt.repo_id] == "create"]
    if resumed:
        print(f"   ♻️   Resumed worktrees : {resumed}")
    if created:
        print(f"   🌿  Created worktrees : {created}")
    print(f"   📦  ChangeSet {cs.id}: {len(cs.pull_requests)} PR(s) across repos {list(worktree_decisions.keys())}")
    return story



def review_agent(story: Story) -> Story:
    """Review all PRs in the ChangeSet; escalate on security/breaking changes."""
    print(f"\n🤖  ReviewAgent  ← [{story.id}] ChangeSet {story.change_set.id if story.change_set else 'none'}")

    result: dict = {}

    def handle_update_status(inp):
        result["decision"] = inp["new_status"]
        story.history.append(f"ReviewAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

    pr_summary = (
        [{"repo_id": pr.repo_id, "branch": pr.branch} for pr in story.change_set.pull_requests]
        if story.change_set else []
    )

    run_agent(
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
        tools=[UPDATE_STATUS_TOOL],
        tool_handlers={"update_status": handle_update_status},
    )

    # ⚠️ HITL: security surface or breaking API change
    if story.has_security_surface or story.is_breaking_api:
        reason = []
        if story.has_security_surface:
            reason.append("security surface detected")
        if story.is_breaking_api:
            reason.append("breaking API change")
        decision = hitl_gate(HITLEscalation(
            trigger_type="Code Review",
            trigger_class="consequence:security" if story.has_security_surface else "consequence:breaking-api",
            work_item_id=story.id,
            reason=", ".join(reason) + f" (across {len(pr_summary)} repo(s))",
        ))
        if "reject" in decision.lower():
            story.status = StoryStatus.IN_DEV
            return story

    # Mark all PRs approved if review passed
    decision = result.get("decision", "in_qa")
    if decision == "in_qa" and story.change_set:
        for pr in story.change_set.pull_requests:
            pr.status = "approved"
        story.change_set.status = "all_approved"

    story.status = StoryStatus(decision)
    return story


def test_agent(story: Story) -> Story:
    print(f"\n🤖  TestAgent  ← [{story.id}] {story.title}")

    result: dict = {}

    def handle_update_status(inp):
        result["decision"] = inp["new_status"]
        result["is_major"] = "major" in inp.get("note", "").lower()
        story.history.append(f"TestAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

    run_agent(
        system_prompt=(
            "You are a Test Agent. Run integration tests across all repos in the ChangeSet.\n"
            "Call update_status with 'staging' if tests pass, 'in_dev' if regression found.\n"
            "Note 'major version' in the note if this is a major release."
        ),
        user_message=f"QA for: {story.title}\n{story.description}",
        tools=[UPDATE_STATUS_TOOL],
        tool_handlers={"update_status": handle_update_status},
    )

    if result.get("is_major"):
        story.is_major_version = True

    story.status = StoryStatus(result.get("decision", "staging"))
    return story


def release_agent(story: Story) -> Story:
    print(f"\n🤖  ReleaseAgent  ← [{story.id}] {story.title}")

    # ⚠️ HITL: major version or infra change
    if story.is_major_version:
        decision = hitl_gate(HITLEscalation(
            trigger_type="Release Approval",
            trigger_class="consequence:major-version",
            work_item_id=story.id,
            reason="Major version — human release approval required.",
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
        print(f"   ✅  [{story.id}] deployed across repos: {repo_ids}")
        print(f"   🧹  Worktrees and branches cleaned up: {branches}")

    story.status = StoryStatus.DONE
    return story


# ---------------------------------------------------------------------------
# Bug agents
# ---------------------------------------------------------------------------

SEVERITY_TOOL = {
    "name": "set_severity",
    "description": "Set severity and priority on a bug.",
    "input_schema": {
        "type": "object",
        "properties": {
            "severity": {"type": "string", "enum": ["critical", "high", "medium", "low"]},
            "priority": {"type": "string", "enum": ["p0", "p1", "p2", "p3"]},
            "is_duplicate": {"type": "boolean"},
            "data_loss_or_security": {"type": "boolean"},
            "note": {"type": "string"},
        },
        "required": ["severity", "priority", "is_duplicate", "data_loss_or_security", "note"],
    },
}

OPEN_BUG_CHANGESET_TOOL = {
    "name": "open_change_set",
    "description": "Create a ChangeSet declaring which repos the fix touches.",
    "input_schema": {
        "type": "object",
        "properties": {
            "repo_ids": {"type": "array", "items": {"type": "string"}},
            "summary": {"type": "string"},
        },
        "required": ["repo_ids", "summary"],
    },
}


def triage_agent(bug: Bug) -> Bug:
    print(f"\n🤖  TriageAgent  ← [{bug.id}] {bug.title}")

    result: dict = {}

    def handle_set_severity(inp):
        result.update(inp)
        bug.history.append(
            f"TriageAgent: severity={inp['severity']} priority={inp['priority']}: {inp['note']}"
        )
        return {"ok": True}

    run_agent(
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
        tools=[SEVERITY_TOOL],
        tool_handlers={"set_severity": handle_set_severity},
    )

    if result.get("is_duplicate"):
        bug.status = BugStatus.CLOSED
        bug.history.append("TriageAgent closed as duplicate.")
        return bug

    bug.severity = result.get("severity", "medium")
    bug.priority = result.get("priority", "p2")
    bug.data_loss_or_security = result.get("data_loss_or_security", False)
    bug.is_p0 = bug.priority == "p0"

    # ⚠️ HITL: data loss, security, or P0
    if bug.data_loss_or_security or bug.is_p0:
        decision = hitl_gate(HITLEscalation(
            trigger_type="Triage Review",
            trigger_class="consequence:data-loss-or-security" if bug.data_loss_or_security else "consequence:p0",
            work_item_id=bug.id,
            reason=f"severity={bug.severity} priority={bug.priority} — human triage confirmation required.",
        ))
        if "reject" in decision.lower():
            bug.status = BugStatus.CLOSED
            return bug

    bug.status = BugStatus.TRIAGED
    return bug


def bug_coding_agent(bug: Bug) -> Bug:
    """Identify which repos the fix touches, open a ChangeSet."""
    print(f"\n🤖  CodingAgent(bug)  ← [{bug.id}] {bug.title}")

    change_set_data: dict = {}

    def handle_open_change_set(inp):
        change_set_data["repo_ids"] = inp["repo_ids"]
        change_set_data["summary"] = inp["summary"]
        bug.history.append(
            f"CodingAgent opened ChangeSet across repos {inp['repo_ids']}: {inp['summary']}"
        )
        return {"ok": True}

    def handle_update_status(inp):
        bug.history.append(f"CodingAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

    repo_list = [{"id": r.id, "name": r.name} for r in bug.project.repos]

    run_agent(
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
        tools=[OPEN_BUG_CHANGESET_TOOL, UPDATE_STATUS_TOOL],
        tool_handlers={
            "open_change_set": handle_open_change_set,
            "update_status": handle_update_status,
        },
    )

    affected_repo_ids = change_set_data.get("repo_ids", [r.id for r in bug.project.repos])
    branch_prefix = f"fix/{bug.id}"

    worktrees = [
        Worktree(
            id=f"wt-{bug.id}-{rid}",
            repo_id=rid,
            branch=Branch(
                id=f"br-{bug.id}-{rid}",
                repo_id=rid,
                name=f"{branch_prefix}-{rid}",
                work_item_id=bug.id,
                work_item_type="bug",
            ),
            path=f"/worktrees/{bug.id}/{rid}",
        )
        for rid in affected_repo_ids
    ]

    cs = ChangeSet(
        id=f"cs-{bug.id}",
        work_item_id=bug.id,
        pull_requests=[
            PullRequest(
                repo_id=wt.repo_id,
                branch=wt.branch.name,
                worktree_id=wt.id,
            )
            for wt in worktrees
        ],
    )
    bug.change_set = cs
    bug.status = BugStatus.IN_REVIEW
    print(f"   🌿  Worktrees: {[wt.id for wt in worktrees]}")
    print(f"   📦  ChangeSet {cs.id}: {len(cs.pull_requests)} PR(s) across repos {affected_repo_ids}")
    return bug


def bug_review_agent(bug: Bug) -> Bug:
    print(f"\n🤖  ReviewAgent(bug)  ← [{bug.id}]")

    result: dict = {}

    def handle_update_status(inp):
        result["decision"] = inp["new_status"]
        bug.history.append(f"ReviewAgent → {inp['new_status']}: {inp['note']}")
        return {"ok": True}

    pr_summary = (
        [{"repo_id": pr.repo_id, "branch": pr.branch} for pr in bug.change_set.pull_requests]
        if bug.change_set else []
    )

    run_agent(
        system_prompt=(
            "You are a Review Agent. Review all PRs in the bug fix ChangeSet.\n"
            "Call update_status with 'verified' if all approved, 'in_progress' if any need changes."
        ),
        user_message=f"Review fix PRs for: {bug.title}\nPRs: {json.dumps(pr_summary)}",
        tools=[UPDATE_STATUS_TOOL],
        tool_handlers={"update_status": handle_update_status},
    )

    decision = result.get("decision", "verified")
    if decision == "verified" and bug.change_set:
        for pr in bug.change_set.pull_requests:
            pr.status = "approved"
        bug.change_set.status = "all_approved"

    bug.status = BugStatus(decision)
    return bug


def bug_release_agent(bug: Bug) -> Bug:
    print(f"\n🤖  ReleaseAgent(bug)  ← [{bug.id}]")

    # 🔴 HITL: P0 hotfix deploy — always
    if bug.is_p0:
        decision = hitl_gate(HITLEscalation(
            trigger_type="Hotfix Deploy Approval",
            trigger_class="mandatory:p0-hotfix-deploy",
            work_item_id=bug.id,
            reason="P0 fix — mandatory human approval before prod deploy.",
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
        print(f"   ✅  [{bug.id}] fix deployed across repos: {repo_ids}")
        print(f"   🧹  Worktrees and branches cleaned up: {branches}")

    bug.status = BugStatus.FIXED
    return bug


# ---------------------------------------------------------------------------
# Orchestrators
# ---------------------------------------------------------------------------

def run_story_workflow(story: Story) -> Story:
    print(f"\n{'='*60}")
    print(f"📖  Story workflow: [{story.id}] {story.title}")
    print(f"    Project: {story.project.name}  |  Repos: {[r.name for r in story.project.repos]}")
    print(f"{'='*60}")

    # ── Grooming loop: re-run SpecCritic if story returns with substantial change ──
    spec_critique = None
    MAX_GROOMING_CYCLES = 3

    for grooming_cycle in range(MAX_GROOMING_CYCLES):
        # Run SpecCritic on first pass, or if PlanningAgent marked substantial change
        if grooming_cycle == 0 or story.substantial_change:
            if grooming_cycle > 0:
                print(f"\n♻️   Re-running SpecCriticAgent (substantial change on revision "
                      f"#{story.spec_revision_count})")
            spec_critique = spec_critic_agent(story)
            story.substantial_change = False   # reset flag after re-critique

        story = planning_agent(story, spec_critique=spec_critique)

        if story.status == StoryStatus.CLOSED:
            return story

        if story.status == StoryStatus.BACKLOG:
            # Sent back for more work — loop again
            print(f"\n   🔄  Story returned to backlog (revision #{story.spec_revision_count})"
                  + (" — substantial change flagged, will re-critique"
                     if story.substantial_change else " — minor revision, reusing critique"))
            continue

        # Approved — exit grooming loop
        break
    else:
        # Exceeded max cycles without approval
        story.history.append(
            f"Story exceeded {MAX_GROOMING_CYCLES} grooming cycles without approval — closed."
        )
        story.status = StoryStatus.CLOSED
        return story

    story.status = StoryStatus.IN_SPRINT

    # ── Development loop: re-run DesignCritic every time coding returns from review ──
    design_critique = None
    MAX_DEV_ITERATIONS = 3

    for dev_iteration in range(MAX_DEV_ITERATIONS):
        # Always re-run DesignCritic on re-entry to dev
        if dev_iteration == 0:
            design_critique = design_critic_agent(
                story,
                critique_context="; ".join(
                    (spec_critique.issues if spec_critique else []) +
                    (spec_critique.questions if spec_critique else [])
                ),
            )
        else:
            print(f"\n♻️   Re-running DesignCriticAgent (dev iteration #{dev_iteration + 1})")
            design_critique = design_critic_agent(story)

        story.dev_iteration_count = dev_iteration
        story = coding_agent(story, design_critique=design_critique)
        story = review_agent(story)

        if story.status == StoryStatus.IN_DEV:
            # Review requested changes — loop back through design critic + coding
            print(f"\n   🔄  Code review requested changes — re-evaluating design approach")
            story.status = StoryStatus.IN_SPRINT   # reset for next iteration
            continue

        # Review passed — exit dev loop
        break
    else:
        story.history.append(
            f"Story exceeded {MAX_DEV_ITERATIONS} dev iterations without passing review — flagged."
        )

    if story.status == StoryStatus.IN_QA:
        story = test_agent(story)

    if story.status == StoryStatus.STAGING:
        story = release_agent(story)

    return story

    if story.status == StoryStatus.IN_DEV:
        story = coding_agent(story)
        story = review_agent(story)

    if story.status == StoryStatus.IN_QA:
        story = test_agent(story)

    if story.status == StoryStatus.STAGING:
        story = release_agent(story)

    return story


def run_bug_workflow(bug: Bug) -> Bug:
    print(f"\n{'='*60}")
    print(f"🐛  Bug workflow: [{bug.id}] {bug.title}")
    print(f"    Project: {bug.project.name}  |  Repos: {[r.name for r in bug.project.repos]}")
    print(f"{'='*60}")

    bug = triage_agent(bug)
    if bug.status == BugStatus.CLOSED:
        return bug

    # 🔴 HITL: P0 sign-off before fix starts — always
    if bug.is_p0:
        decision = hitl_gate(HITLEscalation(
            trigger_type="P0 Sign-off",
            trigger_class="mandatory:p0",
            work_item_id=bug.id,
            reason="P0 bug — mandatory human approval before fix begins.",
        ))
        if "reject" in decision.lower():
            bug.status = BugStatus.CLOSED
            return bug

    bug.status = BugStatus.IN_PROGRESS
    bug = bug_coding_agent(bug)
    bug = bug_review_agent(bug)
    bug = bug_release_agent(bug)

    return bug


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Project with multiple repos
    auth_project = Project(
        id="proj-auth",
        name="Auth Platform",
        repos=[
            Repo(id="repo-auth-svc",    name="auth-service",   primary_language="Python"),
            Repo(id="repo-user-svc",    name="user-service",   primary_language="Python"),
            Repo(id="repo-web-app",     name="web-app",        primary_language="TypeScript"),
            Repo(id="repo-shared-types",name="shared-types",   primary_language="TypeScript"),
        ],
    )

    # Story that will likely span multiple repos
    story = Story(
        id="STORY-42",
        title="Add OAuth2 login via Google",
        description=(
            "Users should be able to sign in with their Google account. "
            "Requires changes to auth-service (new OAuth flow), user-service "
            "(store provider tokens), web-app (login UI), and shared-types "
            "(new UserIdentity contract). The new /auth/google endpoint is a "
            "breaking change to the existing auth API."
        ),
        project=auth_project,
    )

    completed_story = run_story_workflow(story)
    print(f"\nFinal story status : {completed_story.status}")
    if completed_story.change_set:
        print(f"ChangeSet          : {completed_story.change_set.id}  status={completed_story.change_set.status}")
        for pr in completed_story.change_set.pull_requests:
            print(f"  PR → repo={pr.repo_id}  branch={pr.branch}  status={pr.status}")
    print("History:")
    for entry in completed_story.history:
        print(f"  • {entry}")

    print("\n")

    # Bug that touches multiple repos
    bug = Bug(
        id="BUG-99",
        title="User passwords exposed in error logs",
        description=(
            "Stack traces in the production error logger include raw password fields "
            "from failed login attempts. Reproduced in auth-service logs and forwarded "
            "to the shared logging library. Both repos need patching."
        ),
        project=auth_project,
        environment="production",
    )

    completed_bug = run_bug_workflow(bug)
    print(f"\nFinal bug status   : {completed_bug.status}")
    if completed_bug.change_set:
        print(f"ChangeSet          : {completed_bug.change_set.id}  status={completed_bug.change_set.status}")
        for pr in completed_bug.change_set.pull_requests:
            print(f"  PR → repo={pr.repo_id}  branch={pr.branch}  status={pr.status}")
    print("History:")
    for entry in completed_bug.history:
        print(f"  • {entry}")


# ---------------------------------------------------------------------------
# OpsRequest model
# ---------------------------------------------------------------------------

class OpsCategory(str, Enum):
    INFRA_CONFIG  = "infra_config"      # Terraform, k8s, env vars
    ACCESS        = "access"            # Grant/revoke repo or system access
    DATA          = "data"              # Migrations, purges, exports

class OpsExecType(str, Enum):
    CODE_CHANGE   = "code_change"       # Produces a ChangeSet / PR
    DIRECT_ACTION = "direct_action"     # Agent runs tools directly
    RUNBOOK       = "runbook"           # Agent prepares steps; human executes

class OpsRisk(str, Enum):
    LOW    = "low"      # Reversible, non-prod or read-only
    MEDIUM = "medium"   # Prod but recoverable
    HIGH   = "high"     # Destructive, irreversible, or broad blast radius

class OpsStatus(str, Enum):
    NEW       = "new"
    TRIAGED   = "triaged"
    PLANNED   = "planned"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    DONE      = "done"
    CLOSED    = "closed"    # rejected / invalid

@dataclass
class Runbook:
    id: str
    ops_request_id: str
    steps: list = field(default_factory=list)   # list[str]
    status: str = "draft"   # draft | approved | executed

@dataclass
class OpsRequest:
    id: str
    title: str
    description: str
    project: Project = field(default_factory=lambda: Project("p0", "Default"))
    category: OpsCategory = OpsCategory.INFRA_CONFIG
    exec_type: OpsExecType = OpsExecType.DIRECT_ACTION
    risk: OpsRisk = OpsRisk.LOW
    status: OpsStatus = OpsStatus.NEW
    environment: str = "production"
    change_set: Any = None      # ChangeSet | None  (for code_change path)
    runbook: Any = None         # Runbook | None    (for runbook path)
    history: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# OpsRequest tool definitions
# ---------------------------------------------------------------------------

CLASSIFY_OPS_TOOL = {
    "name": "classify_ops",
    "description": (
        "Classify an ops request: set its category, execution type, and risk level. "
        "Use execution_type='code_change' if a PR/Terraform change is needed. "
        "Use 'runbook' for destructive or complex multi-step operations. "
        "Use 'direct_action' for simple, targeted, reversible actions."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["infra_config", "access", "data"],
            },
            "execution_type": {
                "type": "string",
                "enum": ["code_change", "direct_action", "runbook"],
            },
            "risk": {
                "type": "string",
                "enum": ["low", "medium", "high"],
            },
            "reasoning": {"type": "string"},
            "is_invalid": {"type": "boolean"},
        },
        "required": ["category", "execution_type", "risk", "reasoning", "is_invalid"],
    },
}

BUILD_RUNBOOK_TOOL = {
    "name": "build_runbook",
    "description": "Generate a numbered runbook for a human to review and execute.",
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Ordered list of steps the human should execute.",
            },
            "rollback_steps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Steps to undo the operation if something goes wrong.",
            },
        },
        "required": ["steps", "rollback_steps"],
    },
}

EXECUTE_ACTION_TOOL = {
    "name": "execute_action",
    "description": "Simulate executing a direct operational action.",
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "description": "What the agent is doing."},
            "target": {"type": "string", "description": "Resource or system being acted on."},
            "outcome": {"type": "string", "description": "Expected result."},
        },
        "required": ["action", "target", "outcome"],
    },
}

VERIFY_OUTCOME_TOOL = {
    "name": "verify_outcome",
    "description": "Verify that an operation completed successfully.",
    "input_schema": {
        "type": "object",
        "properties": {
            "success": {"type": "boolean"},
            "observations": {"type": "string"},
        },
        "required": ["success", "observations"],
    },
}


# ---------------------------------------------------------------------------
# OpsRequest agents
# ---------------------------------------------------------------------------

def ops_triage_agent(req: OpsRequest) -> OpsRequest:
    """Classify the request: category, execution type, risk."""
    print(f"\n🤖  OpsTriageAgent  ← [{req.id}] {req.title}")

    result: dict = {}

    def handle_classify(inp):
        result.update(inp)
        req.history.append(
            f"OpsTriageAgent: category={inp['category']} "
            f"exec={inp['execution_type']} risk={inp['risk']}: {inp['reasoning']}"
        )
        return {"ok": True}

    run_agent(
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
        tools=[CLASSIFY_OPS_TOOL],
        tool_handlers={"classify_ops": handle_classify},
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


def ops_planning_agent(req: OpsRequest) -> OpsRequest:
    """
    Route to the right execution path.
    code_change  → build a ChangeSet (reuse coding_agent pattern)
    runbook      → generate steps for human review
    direct_action → proceed to execution
    """
    print(f"\n🤖  OpsPlanningAgent  ← [{req.id}] path={req.exec_type.value} risk={req.risk.value}")

    if req.exec_type == OpsExecType.RUNBOOK:
        result: dict = {}

        def handle_build_runbook(inp):
            result["steps"] = inp["steps"]
            result["rollback_steps"] = inp.get("rollback_steps", [])
            req.history.append(f"OpsPlanningAgent built runbook ({len(inp['steps'])} steps).")
            return {"ok": True}

        run_agent(
            system_prompt=(
                "You are an Ops Planning Agent generating a runbook.\n"
                "Call build_runbook with clear, numbered steps and rollback steps."
            ),
            user_message=(
                f"Generate a runbook for: {req.title}\n"
                f"Description: {req.description}\n"
                f"Environment: {req.environment}"
            ),
            tools=[BUILD_RUNBOOK_TOOL],
            tool_handlers={"build_runbook": handle_build_runbook},
        )

        req.runbook = Runbook(
            id=f"rb-{req.id}",
            ops_request_id=req.id,
            steps=result.get("steps", []),
        )
        # Attach rollback as extra steps for visibility
        if result.get("rollback_steps"):
            req.runbook.steps.append("--- ROLLBACK STEPS ---")
            req.runbook.steps.extend(result["rollback_steps"])

    elif req.exec_type == OpsExecType.CODE_CHANGE:
        # Reuse the same ChangeSet pattern as stories/bugs
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
        print(f"   📦  ChangeSet {req.change_set.id}: {len(affected_repos)} PR(s) — will follow normal PR flow.")

    req.status = OpsStatus.PLANNED
    return req


def ops_execution_agent(req: OpsRequest) -> OpsRequest:
    """Execute a direct_action; runbooks and code_changes are handled elsewhere."""
    if req.exec_type != OpsExecType.DIRECT_ACTION:
        return req

    print(f"\n🤖  OpsExecutionAgent  ← [{req.id}] {req.title}")

    # ⚠️ HITL: high/medium risk direct actions need approval before execution
    if req.risk in (OpsRisk.HIGH, OpsRisk.MEDIUM):
        decision = hitl_gate(HITLEscalation(
            trigger_type="Ops Execution Approval",
            trigger_class=f"consequence:ops-{req.risk.value}-risk",
            work_item_id=req.id,
            reason=f"{req.category.value} direct action in {req.environment} — risk={req.risk.value}.",
        ))
        if "reject" in decision.lower():
            req.status = OpsStatus.CLOSED
            return req

    result: dict = {}

    def handle_execute(inp):
        result.update(inp)
        req.history.append(f"OpsExecutionAgent: {inp['action']} on {inp['target']} → {inp['outcome']}")
        return {"ok": True, "simulated": True}

    run_agent(
        system_prompt=(
            "You are an Ops Execution Agent. Simulate executing the operational action.\n"
            "Call execute_action describing what you are doing, the target, and expected outcome."
        ),
        user_message=(
            f"Execute: {req.title}\n"
            f"Description: {req.description}\n"
            f"Environment: {req.environment}"
        ),
        tools=[EXECUTE_ACTION_TOOL],
        tool_handlers={"execute_action": handle_execute},
    )

    req.status = OpsStatus.EXECUTING
    return req


def ops_verify_agent(req: OpsRequest) -> OpsRequest:
    """Verify the operation succeeded; escalate unexpected outcomes."""
    if req.exec_type == OpsExecType.RUNBOOK:
        # Runbook was executed by a human; verification still happens
        pass
    elif req.exec_type == OpsExecType.CODE_CHANGE:
        # Verification done by TestAgent in the PR flow
        req.status = OpsStatus.DONE
        return req

    print(f"\n🤖  OpsVerifyAgent  ← [{req.id}] {req.title}")

    result: dict = {}

    def handle_verify(inp):
        result["success"] = inp["success"]
        result["observations"] = inp["observations"]
        req.history.append(f"OpsVerifyAgent: success={inp['success']} — {inp['observations']}")
        return {"ok": True}

    run_agent(
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
        tools=[VERIFY_OUTCOME_TOOL],
        tool_handlers={"verify_outcome": handle_verify},
    )

    if not result.get("success", True):
        decision = hitl_gate(HITLEscalation(
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


# ---------------------------------------------------------------------------
# OpsRequest orchestrator
# ---------------------------------------------------------------------------

def run_ops_workflow(req: OpsRequest) -> OpsRequest:
    print(f"\n{'='*60}")
    print(f"⚙️   Ops workflow: [{req.id}] {req.title}")
    print(f"    Project: {req.project.name}  |  Env: {req.environment}")
    print(f"{'='*60}")

    req = ops_triage_agent(req)
    if req.status == OpsStatus.CLOSED:
        return req

    req = ops_planning_agent(req)

    if req.exec_type == OpsExecType.RUNBOOK:
        # 🔴 HITL: human always reviews and executes the runbook
        print(f"\n📋  Runbook for [{req.id}]:")
        for i, step in enumerate(req.runbook.steps, 1):
            print(f"   {i}. {step}")
        decision = hitl_gate(HITLEscalation(
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
        # Hand off to normal PR flow — stub here for brevity
        req.history.append("OpsRequest routed to PR flow via ChangeSet.")
        req.status = OpsStatus.EXECUTING

    else:
        req = ops_execution_agent(req)
        if req.status == OpsStatus.CLOSED:
            return req

    req = ops_verify_agent(req)
    return req


# ---------------------------------------------------------------------------
# Extended demo — ops examples
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ops_project = Project(
        id="proj-infra",
        name="Platform Infrastructure",
        repos=[
            Repo(id="repo-infra-tf",  name="infra-terraform", primary_language="HCL"),
            Repo(id="repo-k8s",       name="k8s-manifests",   primary_language="YAML"),
        ],
    )

    # 1. Direct action — low risk (access grant)
    access_req = OpsRequest(
        id="OPS-01",
        title="Grant read access to auth-service repo for new engineer",
        description="New team member Alice needs read access to auth-service for onboarding.",
        project=ops_project,
        environment="github",
    )
    done_access = run_ops_workflow(access_req)
    print(f"\nFinal ops status: {done_access.status}  exec_type={done_access.exec_type.value}  risk={done_access.risk.value}")

    print("\n")

    # 2. Runbook — data purge (always HITL)
    purge_req = OpsRequest(
        id="OPS-02",
        title="Quarterly PII purge — users inactive > 2 years",
        description=(
            "Per retention policy, delete all user records and associated data "
            "for accounts inactive for more than 24 months. Affects users, "
            "audit_logs, and session_tokens tables in prod."
        ),
        project=ops_project,
        environment="production",
    )
    done_purge = run_ops_workflow(purge_req)
    print(f"\nFinal ops status: {done_purge.status}  exec_type={done_purge.exec_type.value}  risk={done_purge.risk.value}")
    if done_purge.runbook:
        print("Runbook steps:")
        for step in done_purge.runbook.steps:
            print(f"  {step}")
