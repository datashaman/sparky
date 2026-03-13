export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  clone_url: string;
  private?: boolean;
}

/**
 * List repos the authenticated user has access to (including private).
 * Fetches from GET /user/repos with affiliation=owner,collaborator.
 */
export async function listUserRepos(): Promise<GitHubRepo[]> {
  const token = localStorage.getItem("github_token");
  if (!token) {
    throw new Error("Not logged in. Sign in with GitHub first.");
  }

  const allRepos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  const maxPages = 5; // Cap at 500 repos for reasonable load time
  while (page <= maxPages) {
    const url = `https://api.github.com/user/repos?affiliation=owner,collaborator&sort=updated&per_page=${perPage}&page=${page}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as GitHubRepo[];
    allRepos.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return allRepos;
}

/**
 * Fetch a GitHub repository by owner and name.
 * Requires the user to be logged in (github_token in localStorage).
 */
export async function fetchRepo(owner: string, name: string): Promise<GitHubRepo> {
  const token = localStorage.getItem("github_token");
  if (!token) {
    throw new Error("Not logged in. Sign in with GitHub first.");
  }

  const fullName = `${owner}/${name}`;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository ${fullName} not found.`);
    }
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as GitHubRepo;
  return data;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user: { login: string; avatar_url: string } | null;
  labels: GitHubLabel[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

/**
 * List open issues for a repository (excludes pull requests).
 * GET /repos/{owner}/{repo}/issues?state=open
 */
export async function listRepoOpenIssues(fullName: string): Promise<GitHubIssue[]> {
  const token = localStorage.getItem("github_token");
  if (!token) {
    throw new Error("Not logged in. Sign in with GitHub first.");
  }
  const repoPath = (fullName || "").trim();
  const slash = repoPath.indexOf("/");
  if (!repoPath || slash === -1) {
    throw new Error(`Invalid repo path: "${fullName}". Expected "owner/name".`);
  }
  const owner = repoPath.slice(0, slash);
  const name = repoPath.slice(slash + 1);
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=open&per_page=100`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as GitHubIssue[];
  return data.filter((i) => !i.pull_request);
}
