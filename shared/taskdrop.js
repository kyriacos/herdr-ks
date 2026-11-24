// Sending a task to an agent: the card menu's "Ask …" rows, and a card dragged off the Tasks board onto an agent or
// a space in the sidebar. Either way the agent is shown and the task's reference is pasted into its prompt, not sent.
//   - shared "ks.taskTarget" = { agent, space } | null: what the sidebar rings (the menu row under the pointer, the
//     row a dragged card is over), so you see where it lands before you let go;
//   - shared "ks.taskDrag" = { id, title, at } | null: a card being dragged; a sidebar row under the pointer takes it.
// Source of truth: shared/taskdrop.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, run, agents } from "herdr";

export const TARGET = "ks.taskTarget", DRAG = "ks.taskDrag";

// A task's reference, for an agent: its id and title, and how to read the rest (the ks-tasks skill knows ks-task).
export const reference = (x) => `Task ${x.id} "${x.title || "Untitled"}" from my board (ks-task show ${x.id} for the details) `;

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const target = () => shared(TARGET) ?? null;
export function setTarget(t) { if (!same(target(), t)) setShared(TARGET, t ?? null); }
// Whether a sidebar row is where the task would land: kind "agent" (an address) or "space" (an id; the space of a
// ringed agent is ringed too).
export function ringed(kind, id) {
  const t = target();
  return Boolean(t && (kind === "agent" ? t.agent === id : t.space === id));
}

// A card being dragged (a stale one, left by a release nobody saw, is ignored after a minute).
export function dragging() { const d = shared(DRAG); return d && Date.now() - (d.at ?? 0) < 60000 ? d : null; }
export function startDrag(x) { setShared(DRAG, { id: x.id, title: x.title ?? "", at: Date.now() }); }
export function endDrag() { if (shared(DRAG)) setShared(DRAG, null); setTarget(null); }

// The agent a space hands a task to: its focused one, else its latest.
export function spaceAgent(spaceId) {
  return agents().filter((a) => a.space === spaceId).sort((a, b) => (b.focused - a.focused) || (b.seq ?? 0) - (a.seq ?? 0))[0] ?? null;
}

export function askAgent(task, address, cx) {
  cx.write_to_clipboard(reference(task));
  run("agent.focus", { terminal: address });
  run("pane.focus", { terminal: address });
  run("terminal.paste");
}

// A sidebar row under the pointer while a card is dragged: ring it (agent: an address, or null for a space's own).
export function hoverDrop(on, agent, space) {
  if (!dragging()) return;
  if (on) setTarget({ agent: agent ?? null, space: space ?? null });
  else if (same(target(), { agent: agent ?? null, space: space ?? null })) setTarget(null);
}
// The card let go over a sidebar row: that agent (or the space's) gets it. True when it took one.
export function dropOn(agent, space, cx) {
  const d = dragging();
  if (!d) return false;
  const address = agent ?? spaceAgent(space)?.address;
  endDrag();
  if (address) askAgent(d, address, cx);
  return Boolean(address);
}
