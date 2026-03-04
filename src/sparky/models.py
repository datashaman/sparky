from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Core data model
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
    status: str = "active"
    work_item_id: str = ""
    work_item_type: str = ""   # story | bug | ops_request
    last_activity_at: str = ""
    interrupted_at: str = ""
    interrupted_reason: str = ""


@dataclass
class PullRequest:
    repo_id: str
    branch: str
    worktree_id: str = ""
    status: str = "open"  # open | approved | changes_requested | merged


@dataclass
class ChangeSet:
    """Groups all PRs needed to implement a story or fix across repos."""
    id: str
    work_item_id: str
    pull_requests: list = field(default_factory=list)  # list[PullRequest]
    status: str = "open"  # open | all_approved | merged

    def all_approved(self) -> bool:
        return bool(self.pull_requests) and all(
            pr.status == "approved" for pr in self.pull_requests
        )


# ---------------------------------------------------------------------------
# Story
# ---------------------------------------------------------------------------

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
    change_set: Any = None  # ChangeSet | None
    spec_revision_count: int = 0
    substantial_change: bool = False
    dev_iteration_count: int = 0
    history: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Bug
# ---------------------------------------------------------------------------

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
    change_set: Any = None  # ChangeSet | None
    history: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Critique
# ---------------------------------------------------------------------------

@dataclass
class Critique:
    id: str
    work_item_id: str
    critic_type: str            # "spec" | "design"
    issues: list = field(default_factory=list)
    questions: list = field(default_factory=list)
    recommendations: list = field(default_factory=list)
    severity: str = "advisory"  # advisory | significant | blocking
    disposition: str = ""       # how the receiving agent responded


# ---------------------------------------------------------------------------
# HITL Escalation
# ---------------------------------------------------------------------------

@dataclass
class HITLEscalation:
    trigger_type: str
    trigger_class: str  # "consequence:security" | "mandatory:p0" etc.
    work_item_id: str
    reason: str
    resolution: str = ""
    resolved_by: str = "human"


# ---------------------------------------------------------------------------
# OpsRequest
# ---------------------------------------------------------------------------

class OpsCategory(str, Enum):
    INFRA_CONFIG  = "infra_config"
    ACCESS        = "access"
    DATA          = "data"


class OpsExecType(str, Enum):
    CODE_CHANGE   = "code_change"
    DIRECT_ACTION = "direct_action"
    RUNBOOK       = "runbook"


class OpsRisk(str, Enum):
    LOW    = "low"
    MEDIUM = "medium"
    HIGH   = "high"


class OpsStatus(str, Enum):
    NEW       = "new"
    TRIAGED   = "triaged"
    PLANNED   = "planned"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    DONE      = "done"
    CLOSED    = "closed"


@dataclass
class Runbook:
    id: str
    ops_request_id: str
    steps: list = field(default_factory=list)  # list[str]
    status: str = "draft"  # draft | approved | executed


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
    change_set: Any = None  # ChangeSet | None
    runbook: Any = None  # Runbook | None
    history: list = field(default_factory=list)
