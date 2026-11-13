// GitHub through `gh` (logged in): one pull request's details, shared by My PRs (pre-fetch) and the PR window.
// Source of truth: shared/github.js; scripts/install.sh copies it into each mod's lib/.
import { exec } from "herdr";

export const PR_FIELDS = "number,title,url,state,isDraft,headRefName,baseRefName,additions,deletions,changedFiles,commits,reviewDecision,mergeStateStatus,statusCheckRollup,latestReviews,reviewRequests,updatedAt,author";

export async function gh(args, cwd) {
  let r = await exec("gh", args, cwd ? { cwd } : undefined).catch(() => null);
  if (!r || (r.code !== 0 && /not found|No such file/i.test(r.stderr ?? ""))) r = await exec("/opt/homebrew/bin/gh", args, cwd ? { cwd } : undefined).catch(() => null);
  return r;
}

// { pr } or { error }. `commits` is cut to a count so the cache stays small.
export async function fetchPr(repo, number) {
  const r = await gh(["pr", "view", String(number), "-R", repo, "--json", PR_FIELDS]);
  if (!r || r.code !== 0) return { error: (r?.stderr || "Couldn't read the PR with gh").trim().split("\n")[0] };
  try {
    const pr = JSON.parse(r.stdout);
    pr.commits = { length: pr.commits?.length ?? 0 };
    pr.statusCheckRollup = (pr.statusCheckRollup ?? []).map((c) => ({ name: c.name, context: c.context, status: c.status, conclusion: c.conclusion, state: c.state }));
    return { pr };
  } catch { return { error: "Couldn't read GitHub's answer" }; }
}

export const prKey = (url) => `pr:${url}`;
