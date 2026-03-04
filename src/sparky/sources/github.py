import os

from github import Auth, Github

from sparky.models import Bug, Project, Repo, Story
from sparky.sources import IssueSource


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

        items: list[Story | Bug] = []
        for issue in repo.get_issues(state="open"):
            # Skip pull requests (GitHub API returns them as issues too)
            if issue.pull_request is not None:
                continue

            label_names = [label.name.lower() for label in issue.labels]
            issue_id = f"GH-{issue.number}"
            title = issue.title
            description = issue.body or ""

            if "bug" in label_names:
                items.append(Bug(
                    id=issue_id,
                    title=title,
                    description=description,
                    project=project,
                ))
            else:
                items.append(Story(
                    id=issue_id,
                    title=title,
                    description=description,
                    project=project,
                ))

        return items
