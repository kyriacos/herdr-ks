// Resuming Claude Code sessions after their terminals were lost (a reboot, a logout, a core crash). Herdr brings a
// lost terminal back as a shell in its last folder, with the same address, and never re-runs its command; the
// conversation is still in ~/.claude/projects. So the tab bar (ks-tabs, one copy) records which session each
// agent terminal runs, and the tab bar and the pane header offer to resume it there.
//
// Shared state "ks.sessions": terminal address -> { sessionId, cwd (where Claude was started: resume runs there),
// title, pane, tab, at (last seen running, ms) }. Shared state is saved to disk, so it survives the restart; it
// changes only when a session, title or place changes, not on every sweep. Source of truth: shared/sessions.js;
// scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, agents, hc, notify } from "herdr";

export const KEY = "ks.sessions";
export const all = () => shared(KEY) ?? {};

// Is a Claude Code agent running in this terminal now?
const isClaude = (a) => /claude/i.test(a?.app ?? "");
export const running = () => new Set(agents().filter(isClaude).map((a) => a.address));

// The remembered session of a terminal whose agent isn't running now, or null. `shell`: the pane shows a shell
// (typing a command there is safe), when the caller knows.
export function resumable(address, shell = true) {
  if (!address || !shell) return null;
  const rec = all()[address];
  if (!rec?.sessionId || running().has(address)) return null;
  return rec;
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Types the resume command into the terminal's shell. `pick`: Claude's own list of that folder's sessions instead.
export async function resume(address, rec, pick = false) {
  const cmd = `cd ${quote(rec.cwd)} && claude --resume${pick ? "" : " " + rec.sessionId}`;
  const r = await hc(["send", address, cmd]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
  if (r.code !== 0) notify({ title: "Couldn't resume the session", body: (r.stderr || r.stdout || "").trim(), level: "error" });
}

export function forget(address) {
  const next = { ...all() };
  delete next[address];
  setShared(KEY, next);
}

// "3h ago" style.
export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const label = (rec) => rec.title || `session ${rec.sessionId.slice(0, 8)}`;
