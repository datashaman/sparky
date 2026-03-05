import asyncio
import os

from github import Auth, Github

from sparky.models import Bug, Project, Repo, Story
from sparky.sources import IssueSource

# Map GitHub issue state to a pseudo-category matching Jira's model.
_STATE_CATEGORY = {
    "open": ("To Do", 2),
    "closed": ("Done", 3),
}


class GitHubSource(IssueSource):
    """Fetches issues from GitHub and maps them to Story/Bug objects."""

    def __init__(self, token: str | None = None) -> None:
        token = token or os.environ.get("GITHUB_TOKEN", "")
        if not token:
            raise ValueError("GITHUB_TOKEN environment variable is required")
        self._gh = Github(auth=Auth.Token(token))

    async def fetch_issues(self, project_key: str) -> list[Story | Bug]:
        """Fetch open issues from a GitHub repo.

        Args:
            project_key: Repository in "owner/repo" format.
        """
        return await asyncio.to_thread(self._fetch_issues_sync, project_key)

    def _fetch_issues_sync(self, project_key: str) -> list[Story | Bug]:
        repo = self._gh.get_repo(project_key)
        project = Project(
            id=f"gh-{repo.full_name}",
            name=repo.name,
            repos=[Repo(
                id=str(repo.id),
                name=repo.name,
                url=repo.html_url,
                primary_language=repo.language or "",
            )],
        )

        me = self._gh.get_user().login

        items: list[Story | Bug] = []
        for issue in repo.get_issues(state="open"):
            # Skip pull requests (GitHub API returns them as issues too)
            if issue.pull_request is not None:
                continue

            # Only include issues assigned to the authenticated user
            assignees = [a.login for a in issue.assignees]
            if me not in assignees:
                continue

            label_names = [label.name.lower() for label in issue.labels]
            issue_id = f"GH-{issue.number}"
            title = issue.title
            description = issue.body or ""

            category, category_id = _STATE_CATEGORY.get(issue.state, ("Open", 2))
            display = {
                "status": issue.state,
                "category": category,
                "category_id": category_id,
                "url": issue.html_url,
            }

            if "bug" in label_names:
                item = Bug(
                    id=issue_id,
                    title=title,
                    description=description,
                    project=project,
                )
            else:
                item = Story(
                    id=issue_id,
                    title=title,
                    description=description,
                    project=project,
                )
            item._display = display  # type: ignore[attr-defined]
            items.append(item)

        return items
