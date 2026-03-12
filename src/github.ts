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
  const url = `https://api.github.com/repos/${encodeURIComponent(fullName)}`;

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
