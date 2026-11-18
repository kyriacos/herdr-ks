// Review comments, shared by the Changes panel, the review tab and the Files panel (Herdr shared state,
// persisted), and sending them to an agent. Source of truth: shared/comments.js; scripts/install.sh copies
// it into each mod's lib/.
import { shared, setShared, agents, focused, spaces, hc, notify } from "herdr";
import { imageLines } from "./attach.js";

const KEY = "ks.comments";

// [{ id, root, branch, path, line (null: the whole file), side ("new" | "old" | null), code, text, at, commit?,
//    images? (pasted pictures, lib/attach.js: { rel, path, name, w, h }) }]
export const all = () => (Array.isArray(shared(KEY)) ? shared(KEY) : []);
export const of = (root, path) => all().filter((c) => c.root === root && (path === undefined || c.path === path));
export const countOf = (root, path) => of(root, path).length;

export function add(c) {
  const comment = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), line: null, side: null, code: "", ...c };
  setShared(KEY, [...all(), comment]);
  return comment;
}
export function update(id, patch) {
  setShared(KEY, all().map((c) => (c.id === id ? { ...c, ...patch } : c)));
}
export function remove(ids) {
  const gone = new Set([].concat(ids));
  setShared(KEY, all().filter((c) => !gone.has(c.id)));
}

// The agent to send to: `prefer` (an address) if it's alive, else the shown tab's (focused first), else one in
// the shown space, else the most recently active one anywhere. { address, title } or null.
export function pickAgent(prefer, spaceId) {
  const list = agents();
  const f = focused(), space = spaceId ?? spaces().find((s) => s.active)?.id;
  const found = (prefer && list.find((a) => a.address === prefer))
    || list.filter((a) => a.tab === f?.tab).sort((a, b) => b.focused - a.focused)[0]
    || list.filter((a) => a.space === space).sort((a, b) => b.seq - a.seq)[0]
    || [...list].sort((a, b) => b.seq - a.seq)[0];
  return found ? { address: found.address, title: `${found.space_name} / ${found.title || found.address}` } : null;
}

// The agents that can receive comments, most recently active first: [{ address, title }].
export function agentChoices() {
  return [...agents()].sort((a, b) => b.seq - a.seq).map((a) => ({ address: a.address, title: `${a.space_name} / ${a.title || a.address}` }));
}

// `note`: extra words for the agent, after the comments (or alone); `noteImages`: pictures pasted into it.
export function format(comments, note = "", noteImages = []) {
  const byRoot = new Map();
  for (const c of comments) (byRoot.get(c.root) ?? byRoot.set(c.root, []).get(c.root)).push(c);
  const parts = [];
  let n = 0;
  for (const [root, list] of byRoot) {
    const branch = list.find((c) => c.branch)?.branch;
    parts.push(`In ${root}${branch ? ` (branch ${branch})` : ""}:`);
    list.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
    for (const c of list) {
      n++;
      const where = (c.line == null ? `${c.path} (whole file)` : `${c.path}:${c.line}${c.side === "old" ? " (removed line)" : ""}`)
        + (c.commit ? ` (in commit ${c.commit})` : "");
      parts.push(`${n}. ${where}${c.code ? `\n   > ${c.code.trim()}` : ""}\n   ${c.text.trim().replace(/\n/g, "\n   ")}${imageLines(c.images, "   ")}`);
    }
  }
  const extra = (note.trim() + imageLines(noteImages)).trim();
  if (!n) return extra;
  return `Please address ${n === 1 ? "this review comment" : `these ${n} review comments`}:\n\n${parts.join("\n\n")}${extra ? `\n\nAlso: ${extra}` : ""}`;
}

// Pastes the comments into the agent and presses enter (hc send), then removes them. Returns true when sent.
export async function send(comments, prefer, spaceId, note = "", noteImages = []) {
  if (!comments.length && !note.trim() && !noteImages.length) return false;
  const agent = pickAgent(prefer, spaceId);
  if (!agent) { notify({ title: "No agent to send to", body: "Start an agent in this space first", level: "warning", timeout: 3500 }); return false; }
  const r = await hc(["send", agent.address, format(comments, note, noteImages)]).catch((e) => ({ code: 1, stderr: String(e) }));
  if (r.code !== 0) { notify({ title: "Couldn't send the comments", body: (r.stderr || r.stdout || "").trim().slice(0, 200), level: "error", timeout: 5000 }); return false; }
  remove(comments.map((c) => c.id));
  notify({ title: comments.length ? `Sent ${comments.length} comment${comments.length === 1 ? "" : "s"}` : "Sent the note", body: `to ${agent.title}`, level: "success", timeout: 3000 });
  return true;
}
