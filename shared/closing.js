// Closing with a grace period (30 s by default, "Undo a close for" in the settings). A closed tab or space isn't closed at once: its tabs are settled (Herdr keeps
// them running, put away on this screen), the tab bar and the sidebar stop showing it, and a toast offers Undo.
// After grace() (30 s unless set otherwise) the tab bar (ks-tabs, one copy) closes it for real. ⌘⇧T, the toast, or the tab bar's
// "↶ Undo close" chip brings it back as it was. Closing a space's last shown tab closes the space (as Herdr does).
//
// Shared state "ks.closing": [{ key, kind: "tab" | "space", id, space, name, tabs (the tabs settled for it),
// until (ms) }], so the sidebar, the tab bar and every menu see the same, and it outlives a restart: a close due
// while Herdr was closed happens at the next start. Source of truth: shared/closing.js; scripts/install.sh copies
// it into each mod's lib/.
import { shared, setShared, spaces, run, notify, openOverlay, closeOverlay } from "herdr";
import { pref } from "./prefs.js";

export const KEY = "ks.closing";
// How long a close waits (settings: "Undo a close for"), ms.
export const grace = () => Math.max(5, Number(pref("undoSeconds")) || 30) * 1000;
// A space with more than one tab is a lot to lose: it waits at least 10 minutes before closing for real.
export const BIG_SPACE = 10 * 60 * 1000;
const spaceGrace = (space) => (space.tabs.length > 1 ? Math.max(grace(), BIG_SPACE) : grace());
const human = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

export const pending = () => shared(KEY) ?? [];
export const hiddenSpace = (id) => pending().some((e) => e.kind === "space" && e.id === id);
export const hiddenTab = (id) => pending().some((e) => (e.kind === "tab" && e.id === id) || (e.kind === "space" && e.tabs.includes(id)));

const shownTabs = (space) => space.tabs.filter((c) => !hiddenTab(c.id));
const tabLabel = (c) => (/^tb\d+$/.test(c.name) ? "tab" : `"${c.name}"`);

function remember(entry) {
  setShared(KEY, [...pending().filter((e) => e.id !== entry.id), entry]);
  notify({
    title: `Closed ${entry.kind === "space" ? "space" : "tab"} ${entry.name}`,
    body: `Click to undo within ${human(entry.until - Date.now())}, or press ⌘⇧T.`,
    level: "info",
    timeout: Math.min(entry.until - Date.now(), 60000),
    action: { name: `ks-tabs.undo:${entry.key}` },
  });
}

export function closeTab(id) {
  const space = spaces().find((s) => s.tabs.some((c) => c.id === id));
  if (!space) return;
  const shown = shownTabs(space);
  if (shown.length <= 1) return closeSpace(space.id);
  const tab = space.tabs.find((c) => c.id === id);
  // Show a neighbour first, so Herdr doesn't pick one that's being closed.
  if (tab.active) {
    const i = shown.findIndex((c) => c.id === id), next = shown[i + 1] ?? shown[i - 1];
    if (next) run("tab.select", { id: next.id });
  }
  run("tab.settle", { id });
  remember({ key: `${id}-${Date.now()}`, kind: "tab", id, space: space.id, name: tabLabel(tab), tabs: [id], until: Date.now() + grace() });
}

export function closeSpace(id) {
  const all = spaces(), space = all.find((s) => s.id === id);
  if (!space) return;
  if (space.active) {
    const others = all.filter((s) => s.id !== id && !hiddenSpace(s.id));
    const i = all.findIndex((s) => s.id === id);
    const next = others.find((s) => all.indexOf(s) > i) ?? others[others.length - 1];
    if (next) run("space.select", { id: next.id });
  }
  const tabs = space.tabs.filter((c) => !c.settled).map((c) => c.id);
  for (const t of tabs) run("tab.settle", { id: t });
  remember({ key: `${id}-${Date.now()}`, kind: "space", id, space: id, name: `"${space.name}"`, tabs, until: Date.now() + spaceGrace(space) });
}

// Brings back the entry with this key, else the most recent one.
export function undo(key) {
  const list = pending(), entry = list.find((e) => e.key === key) ?? (key ? null : list[list.length - 1]);
  if (!entry) return false;
  setShared(KEY, list.filter((e) => e !== entry));
  for (const t of entry.tabs) run("tab.unsettle", { id: t });
  if (entry.kind === "space") run("space.select", { id: entry.id });
  else run("tab.select", { id: entry.id });
  notify({ title: `Reopened ${entry.kind} ${entry.name}`, level: "info", timeout: 3000 });
  return true;
}

// Closes for real what's due. Called every second by ks-tabs.
export function finish(now = Date.now()) {
  const list = pending();
  if (!list.length) return;
  const sp = spaces(), due = list.filter((e) => e.until <= now);
  if (!due.length) return;
  setShared(KEY, list.filter((e) => e.until > now));
  for (const e of due) {
    if (e.kind === "space") { if (sp.some((s) => s.id === e.id)) run("space.close", { id: e.id, confirmed: true }); }
    else if (sp.some((s) => s.tabs.some((c) => c.id === e.id))) run("tab.close", { id: e.id, confirmed: true });
  }
}

// One dialog at a time (the key ks-confirm clears); `soft` tells ks-confirm what to close on Confirm.
export function ask({ kind, id, title, detail, wait = grace(), height = 170 }) {
  if (shared("ks-confirm.open")) closeOverlay(shared("ks-confirm.open"));
  setShared("ks-confirm.open", openOverlay({ mod: "ks-confirm", kind: "dialog", width: 420, height,
    props: { title, detail: `${detail ? detail + " " : ""}You can undo for ${human(wait)} (⌘⇧T).`, soft: { kind, id } } }));
}

export function askSpace(id) {
  const space = spaces().find((s) => s.id === id);
  if (!space) return;
  const n = space.tabs.length;
  const names = space.tabs.map((c) => (/^tb\d+$/.test(c.name) ? "unnamed" : c.name)), shown = names.slice(0, 4).join(", ") + (n > 4 ? ` and ${n - 4} more` : "");
  ask({ kind: "space", id, title: `Close space "${space.name}"?`, wait: spaceGrace(space), height: n > 1 ? 200 : 170,
    detail: n === 1 ? "Its tab and terminals end." : `All ${n} tabs (${shown}) and their terminals and agents end.` });
}
