// Resuming agent sessions (Claude Code, Codex) after their terminals were lost (a reboot, a logout, a core crash). Herdr brings a
// lost terminal back as a shell in its last folder, with the same address, and never re-runs its command; the
// conversation is still on disk (~/.claude/projects, ~/.codex/sessions). So the tab bar (ks-tabs, one copy) records which session each
// agent terminal runs, and the tab bar and the pane header offer to resume it there.
//
// Shared state "ks.sessions": terminal address -> { sessionId, app ("claude" | "codex"; none means claude), cwd
// (where the agent was started: resume runs there), title, pane, tab, at (last seen running, ms) }. Shared state is saved to disk, so it survives the restart; it
// changes only when a session, title or place changes, not on every sweep. Source of truth: shared/sessions.js;
// scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, agents, hc, notify, appHome } from "herdr";

export const KEY = "ks.sessions";
export const all = () => shared(KEY) ?? {};

// Agents whose sessions can be resumed, and which one an agent is.
export const appOf = (a) => (/claude/i.test(a?.app ?? "") ? "claude" : /codex/i.test(a?.app ?? "") ? "codex" : null);
export const NAMES = { claude: "Claude Code", codex: "Codex" };
export const nameOf = (rec) => NAMES[rec?.app ?? "claude"] ?? "The agent";
// Is such an agent running in this terminal now?
export const running = () => new Set(agents().filter(appOf).map((a) => a.address));

// The remembered session of a terminal whose agent isn't running now, or null. `shell`: the pane shows a shell
// (typing a command there is safe), when the caller knows.
export function resumable(address, shell = true) {
  if (!address || !shell) return null;
  const rec = all()[address];
  if (!rec?.sessionId || running().has(address)) return null;
  return rec;
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Types the resume command into the terminal's shell. `pick`: the agent's own list of sessions instead.
export async function resume(address, rec, pick = false) {
  const run = rec.app === "codex" ? `codex resume${pick ? "" : " " + rec.sessionId}` : `claude --resume${pick ? "" : " " + rec.sessionId}`;
  const cmd = `cd ${quote(rec.cwd)} && ${run}`;
  const r = await hc(["send", address, cmd]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
  if (r.code !== 0) notify({ title: "Couldn't resume the session", body: (r.stderr || r.stdout || "").trim(), level: "error" });
}

// Draws the session as a card inside the terminal (ks-tabs/last_session.py: title, folder, prompts, last reply,
// files edited), waiting for Enter to resume it there. Claude Code only: the card reads its log format.
export const hasCard = (rec) => (rec?.app ?? "claude") === "claude";
export async function showCard(address, rec) {
  if (!hasCard(rec)) return;
  const script = `${appHome()}/mods/ks-tabs/last_session.py`;
  const since = Math.round((Date.now() - (rec.at ?? Date.now())) / 1000);
  await hc(["send", address, `clear; python3 -I ${quote(script)} ${rec.sessionId} ${quote(rec.cwd)} ${since}`]).catch(() => null);
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
