import { execFileSync, execSync } from "node:child_process";

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

/** Sanitize error messages to strip tokens/credentials before returning to callers. */
function sanitizeError(e: unknown, token: string): string {
  let msg = e instanceof Error ? e.message : String(e);
  // Redact the raw token and its base64-encoded form
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  msg = msg.replaceAll(token, "[REDACTED]");
  msg = msg.replaceAll(b64, "[REDACTED]");
  return msg;
}

export async function createPullRequest(
  ctx: GitHubToolContext,
  worktreePath: string,
  title: string,
  body: string,
): Promise<string> {
  const gitExec = (...args: string[]) =>
    execFileSync("git", args, { cwd: worktreePath, encoding: "utf-8", timeout: 30_000 }).trim();

  try {
    // 1. Check for changes
    const status = gitExec("status", "--porcelain");
    if (!status) return "No changes to commit.";

    // 2. Stage and commit
    gitExec("add", "-A");
    const commitMessage = `${title}\n\n${body}`;
    execFileSync("git", ["commit", "-m", commitMessage], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 30_000,
    });

    // 3. Get branch name
    const branch = gitExec("rev-parse", "--abbrev-ref", "HEAD");

    // 4. Push with auth — use env var to avoid token in argv/error messages
    const basicAuth = Buffer.from(`x-access-token:${ctx.token}`).toString("base64");
    execSync(
      `git -c http.extraHeader="Authorization: Basic $GIT_AUTH_TOKEN" push --force-with-lease -u origin ${branch}`,
      {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 30_000,
        env: { ...process.env, GIT_AUTH_TOKEN: basicAuth },
      },
    );

    // 5. Detect default branch
    let defaultBranch = "main";
    try {
      const ref = gitExec("symbolic-ref", "refs/remotes/origin/HEAD", "--short");
      defaultBranch = ref.replace(/^origin\//, "");
    } catch {
      // fallback to main
    }

    // 6. Create PR
    const prBody = `${body}\n\nResolves #${ctx.parentIssueNumber}`;
    const res = await fetch(`https://api.github.com/repos/${ctx.repoFullName}/pulls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ctx.token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body: prBody, head: branch, base: defaultBranch }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      // Detect "PR already exists" specifically
      if (res.status === 422 && errorBody.includes("A pull request already exists")) {
        return `Pull request already exists for branch ${branch}. Changes have been pushed.`;
      }
      return `Error creating pull request (${res.status}): ${errorBody}`;
    }

    const data = (await res.json()) as { number: number; html_url: string };
    return `Pull request #${data.number} created: ${data.html_url}`;
  } catch (e) {
    throw new Error(sanitizeError(e, ctx.token));
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
