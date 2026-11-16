// CI checks from GitHub's statusCheckRollup, one rule for My PRs, the PRs panel and the PR window.
// Source of truth: shared/ci.js; scripts/install.sh copies it into each mod's lib/.
//
// A check is "fail" only when it really failed. Cancelled, skipped and neutral checks (a run superseded by a newer
// push, a job that didn't apply) don't count either way; one waiting for approval (ACTION_REQUIRED) counts as
// running. So a PR shows running (orange) while anything is still going, unless something has already failed.

const FAILED = new Set(["FAILURE", "TIMED_OUT", "ERROR", "STARTUP_FAILURE"]);
const WAITING = new Set(["PENDING", "EXPECTED", "ACTION_REQUIRED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", ""]);
const IGNORED = new Set(["CANCELLED", "SKIPPED", "NEUTRAL", "STALE"]);

// "fail" | "running" | "pass" | "skip" for one check (a CheckRun { status, conclusion } or a StatusContext { state }).
export function checkKind(c) {
  const s = String(c?.conclusion || c?.state || "").toUpperCase(), st = String(c?.status || "").toUpperCase();
  if (st && st !== "COMPLETED") return "running";
  if (FAILED.has(s)) return "fail";
  if (IGNORED.has(s)) return "skip";
  if (WAITING.has(s)) return "running";
  return "pass";
}

// { ci: "fail" | "running" | "pass" | "none", counts: { pass, fail, running, skip } } for a list of checks.
export function summarize(checks) {
  const counts = { pass: 0, fail: 0, running: 0, skip: 0 };
  for (const c of checks ?? []) counts[checkKind(c)]++;
  const ci = counts.fail ? "fail" : counts.running ? "running" : counts.pass ? "pass" : "none";
  return { ci, counts };
}

// Orange for "running": themes have no orange of their own (and a red/yellow mix comes out pink in some), so a fixed
// one, darker on a light background so it reads on both.
export function orange(t) {
  const bg = hex(t.background);
  const light = bg ? (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.55 : false;
  return light ? "#c2620c" : "#f0913a";
}
function hex(c) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(c ?? ""));
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
}
