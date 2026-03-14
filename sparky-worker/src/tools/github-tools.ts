import { execSync } from "node:child_process";

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
  createdIssues: Set<number>,
  title?: string,
  body?: string,
): Promise<string> {
  if (!createdIssues.has(issueNumber)) {
    return `Error: cannot update issue #${issueNumber} — only issues created by the agent in this session can be updated.`;
  }
  const payload: Record<string, unknown> = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (Object.keys(payload).length === 0) return "No fields to update.";

  await githubFetch(ctx, `/repos/${ctx.repoFullName}/issues/${issueNumber}`, "PATCH", payload);
  return `Issue #${issueNumber} updated.`;
}

export async function createPullRequest(
  ctx: GitHubToolContext,
  worktreePath: string,
  title: string,
  body: string,
): Promise<string> {
  const git = (cmd: string) =>
    execSync(cmd, { cwd: worktreePath, encoding: "utf-8", timeout: 30_000 }).trim();

  // 1. Check for changes
  const status = git("git status --porcelain");
  if (!status) return "No changes to commit.";

  // 2. Stage and commit
  git("git add -A");
  const commitMessage = `${title}\n\n${body}`;
  execSync("git commit -m " + JSON.stringify(commitMessage), {
    cwd: worktreePath,
    encoding: "utf-8",
    timeout: 30_000,
  });

  // 3. Get branch name
  const branch = git("git rev-parse --abbrev-ref HEAD");

  // 4. Push with auth
  const basicAuth = Buffer.from(`x-access-token:${ctx.token}`).toString("base64");
  git(
    `git -c http.extraHeader="Authorization: Basic ${basicAuth}" push --force-with-lease -u origin ${branch}`,
  );

  // 5. Detect default branch
  let defaultBranch = "main";
  try {
    const ref = git("git symbolic-ref refs/remotes/origin/HEAD --short");
    defaultBranch = ref.replace(/^origin\//, "");
  } catch {
    // fallback to main
  }

  // 6. Create PR
  const prBody = `${body}\n\nResolves #${ctx.parentIssueNumber}`;
  try {
    const res = await githubFetch(ctx, `/repos/${ctx.repoFullName}/pulls`, "POST", {
      title,
      body: prBody,
      head: branch,
      base: defaultBranch,
    });
    const data = (await res.json()) as { number: number; html_url: string };
    return `Pull request #${data.number} created: ${data.html_url}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("422")) {
      return `Pull request already exists for branch ${branch}. Changes have been pushed.`;
    }
    throw e;
  }
}

export async function closeGitHubIssue(
  ctx: GitHubToolContext,
  issueNumber: number,
  createdIssues: Set<number>,
  reason: string,
): Promise<string> {
  if (!createdIssues.has(issueNumber)) {
    return `Error: cannot close issue #${issueNumber} — only issues created by the agent in this session can be closed.`;
  }
  await githubFetch(ctx, `/repos/${ctx.repoFullName}/issues/${issueNumber}`, "PATCH", {
    state: "closed",
    state_reason: reason === "completed" ? "completed" : "not_planned",
  });
  return `Issue #${issueNumber} closed (${reason}).`;
}
