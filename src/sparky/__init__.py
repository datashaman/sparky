import argparse
import asyncio
import logging

from sparky.models import (
    Bug, OpsRequest, Project, Repo, Story,
)
from sparky.workflows.story import run_story_workflow
from sparky.workflows.bug import run_bug_workflow
from sparky.workflows.ops import run_ops_workflow


async def run_demo() -> None:
    """Run the hardcoded demo workflows."""
    # Project with multiple repos
    auth_project = Project(
        id="proj-auth",
        name="Auth Platform",
        repos=[
            Repo(id="repo-auth-svc",     name="auth-service",  primary_language="Python"),
            Repo(id="repo-user-svc",     name="user-service",  primary_language="Python"),
            Repo(id="repo-web-app",      name="web-app",       primary_language="TypeScript"),
            Repo(id="repo-shared-types", name="shared-types",  primary_language="TypeScript"),
        ],
    )

    # --- Story workflow ---
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

    completed_story = await run_story_workflow(story)
    print(f"\nFinal story status : {completed_story.status}")
    if completed_story.change_set:
        print(f"ChangeSet          : {completed_story.change_set.id}  status={completed_story.change_set.status}")
        for pr in completed_story.change_set.pull_requests:
            print(f"  PR -> repo={pr.repo_id}  branch={pr.branch}  status={pr.status}")
    print("History:")
    for entry in completed_story.history:
        print(f"  * {entry}")

    print("\n")

    # --- Bug workflow ---
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

    completed_bug = await run_bug_workflow(bug)
    print(f"\nFinal bug status   : {completed_bug.status}")
    if completed_bug.change_set:
        print(f"ChangeSet          : {completed_bug.change_set.id}  status={completed_bug.change_set.status}")
        for pr in completed_bug.change_set.pull_requests:
            print(f"  PR -> repo={pr.repo_id}  branch={pr.branch}  status={pr.status}")
    print("History:")
    for entry in completed_bug.history:
        print(f"  * {entry}")

    print("\n")

    # --- Ops workflow ---
    ops_project = Project(
        id="proj-infra",
        name="Platform Infrastructure",
        repos=[
            Repo(id="repo-infra-tf", name="infra-terraform", primary_language="HCL"),
            Repo(id="repo-k8s",      name="k8s-manifests",   primary_language="YAML"),
        ],
    )

    access_req = OpsRequest(
        id="OPS-01",
        title="Grant read access to auth-service repo for new engineer",
        description="New team member Alice needs read access to auth-service for onboarding.",
        project=ops_project,
        environment="github",
    )
    done_access = await run_ops_workflow(access_req)
    print(f"\nFinal ops status: {done_access.status}  exec_type={done_access.exec_type.value}  risk={done_access.risk.value}")

    print("\n")

    purge_req = OpsRequest(
        id="OPS-02",
        title="Quarterly PII purge -- users inactive > 2 years",
        description=(
            "Per retention policy, delete all user records and associated data "
            "for accounts inactive for more than 24 months. Affects users, "
            "audit_logs, and session_tokens tables in prod."
        ),
        project=ops_project,
        environment="production",
    )
    done_purge = await run_ops_workflow(purge_req)
    print(f"\nFinal ops status: {done_purge.status}  exec_type={done_purge.exec_type.value}  risk={done_purge.risk.value}")
    if done_purge.runbook:
        print("Runbook steps:")
        for step in done_purge.runbook.steps:
            print(f"  {step}")


async def run_from_source(items: list[Story | Bug]) -> None:
    """Run workflows for issues fetched from an external source."""
    for item in items:
        if isinstance(item, Bug):
            completed = await run_bug_workflow(item)
            print(f"\n[{completed.id}] {completed.title} — status: {completed.status}")
        else:
            completed = await run_story_workflow(item)
            print(f"\n[{completed.id}] {completed.title} — status: {completed.status}")


async def async_main() -> None:
    parser = argparse.ArgumentParser(
        prog="sparky",
        description="AI-powered story grooming workflow",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--github",
        metavar="OWNER/REPO",
        help="Fetch issues from a GitHub repository",
    )
    group.add_argument(
        "--jira",
        metavar="PROJECT_KEY",
        help="Fetch issues from a Jira project",
    )
    args = parser.parse_args()

    if args.github:
        from sparky.sources.github import GitHubSource

        source = GitHubSource()
        items = await source.fetch_issues(args.github)
        if not items:
            print(f"No open issues found in {args.github}")
            return
        print(f"Fetched {len(items)} issues from GitHub ({args.github})")
        await run_from_source(items)

    elif args.jira:
        from sparky.sources.jira import JiraSource

        source = JiraSource()
        items = await source.fetch_issues(args.jira)
        if not items:
            print(f"No open issues found in {args.jira}")
            return
        print(f"Fetched {len(items)} issues from Jira ({args.jira})")
        await run_from_source(items)

    else:
        await run_demo()


def main() -> None:
    fmt = "%(asctime)s %(name)s %(levelname)s  %(message)s"
    datefmt = "%H:%M:%S"

    # Console: INFO
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(fmt, datefmt=datefmt))

    # File: DEBUG (full trace)
    fileh = logging.FileHandler("sparky.log", mode="w")
    fileh.setLevel(logging.DEBUG)
    fileh.setFormatter(logging.Formatter(
        "%(asctime)s.%(msecs)03d %(name)s %(levelname)s  %(message)s",
        datefmt="%H:%M:%S",
    ))

    logger = logging.getLogger("sparky")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(console)
    logger.addHandler(fileh)

    asyncio.run(async_main())
