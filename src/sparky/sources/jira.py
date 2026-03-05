import asyncio
import os

from jira import JIRA

from sparky.models import Bug, Project, Story
from sparky.sources import IssueSource

PRIORITY_MAP = {
    "highest": "critical",
    "high": "high",
    "medium": "normal",
    "low": "low",
    "lowest": "low",
}


class JiraSource(IssueSource):
    """Fetches issues from Jira and maps them to Story/Bug objects."""

    def __init__(
        self,
        url: str | None = None,
        user: str | None = None,
        token: str | None = None,
    ) -> None:
        url = url or os.environ.get("JIRA_URL", "")
        user = user or os.environ.get("JIRA_USER", "")
        token = token or os.environ.get("JIRA_TOKEN", "")
        if not all([url, user, token]):
            raise ValueError(
                "JIRA_URL, JIRA_USER, and JIRA_TOKEN environment variables are required"
            )
        self._url = url
        self._jira = JIRA(server=url, basic_auth=(user, token))

    async def fetch_issues(self, project_key: str) -> list[Story | Bug]:
        """Fetch open issues from a Jira project.

        Args:
            project_key: Jira project key (e.g., "PROJ").
        """
        return await asyncio.to_thread(self._fetch_issues_sync, project_key)

    def _fetch_issues_sync(self, project_key: str) -> list[Story | Bug]:
        jql = f'project = "{project_key}" AND assignee = currentUser() AND sprint in openSprints() AND status != Done ORDER BY created DESC'
        issues = self._jira.search_issues(jql, maxResults=50)

        project = Project(
            id=f"jira-{project_key}",
            name=project_key,
        )

        items: list[Story | Bug] = []
        for issue in issues:
            issue_type = (issue.fields.issuetype.name or "").lower()
            title = issue.fields.summary or ""
            description = issue.fields.description or ""
            priority_name = (getattr(issue.fields.priority, "name", "") or "").lower()
            priority = PRIORITY_MAP.get(priority_name, "normal")

            status = (getattr(issue.fields.status, "name", "") or "")
            status_category = getattr(issue.fields.status, "statusCategory", None)
            category = (getattr(status_category, "name", "") or "")
            category_id = int(getattr(status_category, "id", 999))
            url = f"{self._url}/browse/{issue.key}"
            display = {"status": status, "category": category, "category_id": category_id, "url": url}

            if issue_type == "bug":
                item = Bug(
                    id=issue.key,
                    title=title,
                    description=description,
                    project=project,
                    priority=priority,
                )
            else:
                item = Story(
                    id=issue.key,
                    title=title,
                    description=description,
                    project=project,
                    priority=priority,
                )
            item._display = display  # type: ignore[attr-defined]
            items.append(item)

        return items
