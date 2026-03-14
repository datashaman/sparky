export interface GitHubToolContext {
  token: string;
  repoFullName: string;
  parentIssueNumber: number;
}

async function githubFetch(ctx: GitHubToolContext, path: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${ctx.token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res;
}

export async function createGitHubIssue(
  ctx: GitHubToolContext,
  title: string,
  body: string,
  labels?: string[],
): Promise<{ number: number; html_url: string }> {
  const fullBody = `${body}\n\nPart of #${ctx.parentIssueNumber}`;
  const payload: Record<string, unknown> = { title, body: fullBody };
  if (labels?.length) payload.labels = labels;

  const res = await githubFetch(ctx, `/repos/${ctx.repoFullName}/issues`, "POST", payload);
  const data = await res.json() as { number: number; html_url: string };
  return { number: data.number, html_url: data.html_url };
}

export async function updateGitHubIssue(
  ctx: GitHubToolContext,
  issueNumber: number,
  title?: string,
  body?: string,
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (Object.keys(payload).length === 0) return "No fields to update.";

  await githubFetch(ctx, `/repos/${ctx.repoFullName}/issues/${issueNumber}`, "PATCH", payload);
  return `Issue #${issueNumber} updated.`;
}

export async function closeGitHubIssue(
  ctx: GitHubToolContext,
  issueNumber: number,
  createdIssues: Set<number>,
): Promise<string> {
  if (!createdIssues.has(issueNumber)) {
    return `Error: cannot close issue #${issueNumber} — only issues created by the agent in this session can be closed.`;
  }
  await githubFetch(ctx, `/repos/${ctx.repoFullName}/issues/${issueNumber}`, "PATCH", { state: "closed" });
  return `Issue #${issueNumber} closed.`;
}
