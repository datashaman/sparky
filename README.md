# Sparky

AI-powered software development workflow engine. Sparky automates grooming, development, review, and release pipelines for Stories, Bugs, and Ops Requests using a pipeline of Claude AI agents.

## How It Works

Work items flow through sequences of specialized agents that classify, plan, implement, review, test, and release changes. Human-in-the-loop (HITL) gates pause execution at high-consequence decision points (security, P0 bugs, major releases, cross-team scope) but don't interrupt low-risk automation.

**Philosophy: escalate on consequence, not on confidence.**

### Workflows

**Story**: SpecCritic → Planning → DesignCritic → Coding → Review → Test → Release
- Grooming loop (up to 3 cycles) refines specs before development begins
- Development loop (up to 3 iterations) handles review feedback

**Bug**: Triage → Coding → Review → Release
- P0 bugs trigger mandatory HITL sign-off before fix and deploy

**Ops Request**: Triage → Planning → Execution → Verification
- Routes by execution type: code change, direct action, or runbook
- Runbooks always require human review before execution

## Installation

Requires Python >= 3.13 and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
```

## Configuration

Set your Anthropic API key (required for all modes):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

For GitHub integration:

```bash
export GITHUB_TOKEN=ghp_...
```

For Jira integration:

```bash
export JIRA_URL=https://mycompany.atlassian.net
export JIRA_USER=me@mycompany.com
export JIRA_TOKEN=...
```

## Usage

```bash
# Run hardcoded demo (story + bug + ops workflows)
sparky

# Fetch open issues from a GitHub repo
sparky --github owner/repo

# Fetch open issues from a Jira project
sparky --jira PROJECT_KEY
```

`--github` and `--jira` are mutually exclusive. Issues labeled "bug" (GitHub) or with issue type "Bug" (Jira) are routed to the bug workflow; all others go through the story workflow.

## Project Structure

```
src/sparky/
├── __init__.py          # CLI entry point
├── models.py            # Dataclasses: Story, Bug, OpsRequest, ChangeSet, etc.
├── sdk.py               # Claude Agent SDK wrapper (run_agent)
├── tools.py             # Tool factories for agent state mutations
├── hitl.py              # Human-in-the-loop escalation gate
├── agents/
│   ├── story.py         # SpecCritic, DesignCritic, Planning, Coding, Review, Test, Release
│   ├── bug.py           # Triage, Coding, Review, Release
│   └── ops.py           # Triage, Planning, Execution, Verify
├── workflows/
│   ├── story.py         # Story workflow orchestration
│   ├── bug.py           # Bug workflow orchestration
│   └── ops.py           # Ops workflow orchestration
└── sources/
    ├── __init__.py      # IssueSource protocol
    ├── github.py        # GitHub Issues adapter
    └── jira.py          # Jira adapter
```

## HITL Gates

| Trigger | When |
|---|---|
| Scope Review | Story touches multiple teams |
| Code Review | Security surface or breaking API change |
| Release Approval | Major version release |
| Triage Review | Data loss/security bug or P0 |
| P0 Sign-off | Always for P0 bugs |
| Hotfix Deploy | Always for P0 bug deploys |
| Ops Execution | Direct action with medium/high risk |
| Runbook Review | Always for runbook execution |
| Ops Failure | Verification reports failure |

## Design

Reference diagrams and prototypes live in `design/`:
- `object-model.mermaid` — data model ER diagram
- `workflow-transitions.mermaid` — full workflow lifecycle flowchart
- `dev_workflow.py` — original monolithic prototype
