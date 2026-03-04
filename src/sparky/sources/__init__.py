from typing import Protocol, runtime_checkable

from sparky.models import Story, Bug


@runtime_checkable
class IssueSource(Protocol):
    """Protocol for fetching issues from external sources."""

    async def fetch_issues(self, project_key: str) -> list[Story | Bug]:
        """Fetch issues from the source and return them as Story/Bug objects."""
        ...
