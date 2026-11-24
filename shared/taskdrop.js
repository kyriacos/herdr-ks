// Sending a task to an agent from a card's menu ("Ask …"): the agent is shown and the task's reference is pasted
// into its prompt, not sent. Shared "ks.taskTarget" = { agent, space } | null: what the sidebar rings while an Ask
// row is under the pointer (or chosen with the keys), so you see where it lands.
// (Dragging a card onto the sidebar can't work: a drag stays inside the panel it started in.)
// Source of truth: shared/taskdrop.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, run } from "herdr";

export const TARGET = "ks.taskTarget";

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

export function askAgent(task, address, cx) {
  cx.write_to_clipboard(reference(task));
  run("agent.focus", { terminal: address });
  run("pane.focus", { terminal: address });
  run("terminal.paste");
}
