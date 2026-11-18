// When closing a tab or a pane asks first. Herdr's own tab.close asks only when the space would close
// with it, and Herdr's Settings have no switch for it, so every way this layout closes one comes here:
// a tab's × and menu and cmd-w (ks-tabs), a pane's × and menu (ks-pane) and cmd-shift-w (ks-tabs).
// Mods can't import from each other: this file is copied as-is into both, and scripts/sync.sh
// refuses to install copies that differ.
import { spaces, panes, agents, terminals, run, openOverlay, closeOverlay, shared, setShared, exec, hc } from "herdr";
import * as closing from "./lib/closing.js";

// One choice for tabs (the tab menu sets it) and one for panes (the terminal menu), each under the
// name of the mod whose menu sets it. In shared state, so it outlives a restart and both mods see it.
const KEYS = { tab: "ks-tabs.confirm-close", pane: "ks-pane.confirm-close" };
export const MODES = [
  ["never", "Never"],
  ["agents", "While something runs in it"],
  ["always", "Always"],
];
// ks: closing a tab asks every time unless chosen otherwise (and can be undone for 30 s, lib/closing.js).
const DEFAULT = { tab: "always", pane: "agents" };
export const confirmMode = (kind) => (MODES.some(([m]) => m === shared(KEYS[kind])) ? shared(KEYS[kind]) : DEFAULT[kind]);
export const setConfirmMode = (kind, mode) => setShared(KEYS[kind], mode);

// A tab's program: its agent's, else its first pane's.
export function tabProgram(c) {
  const mine = panes().filter(p => p.tab === c.id);
  return mine.find(p => p.program?.agent)?.program ?? mine[0]?.program;
}

// A tab nobody named shows its program, as the tab bar draws it.
export const tabName = (c, program = tabProgram(c)) => /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;

// The dialog's title doesn't wrap: a long name is cut to what fits, a wide (CJK) character counting twice.
function fit(name, room = 26) {
  let used = 0, out = "";
  for (const ch of name) {
    used += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
    if (used > room) return out.trimEnd() + "…";
    out += ch;
  }
  return out;
}

// Every agent counts, whatever its status: one sitting idle at its prompt still holds a session (its context, what
// it was doing) that closing ends just the same.
const busy = (keep) => agents().filter(keep);

// What runs in these terminals besides a shell waiting at its prompt: the foreground program (`hc get`: the
// terminal's own pid is its shell, `foreground` what has the terminal now) and the shell's background jobs (`ps`:
// its other children). Agents' terminals are left out (`skip`): they're listed as agents. Prompt helpers
// (gitstatusd, a plain subshell) don't count. Resolves to short labels, e.g. ["npm run dev", "vite"].
const HELPER = /(^|\/)(gitstatusd[^ ]*|caffeinate|-?(zsh|bash|sh|fish))( |$)(?!.*-c)/;
async function running(addresses, skip = new Set()) {
  const local = addresses.filter(a => a && !a.includes("/") && !skip.has(a));
  if (!local.length) return [];
  const ps = await exec("ps", ["-Ao", "pid=,ppid=,args="], { timeout: 4000 }).catch(() => null);
  const kids = new Map();
  for (const line of String(ps?.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) (kids.get(Number(m[2])) ?? kids.set(Number(m[2]), []).get(Number(m[2]))).push({ pid: Number(m[1]), args: m[3] });
  }
  const short = (args) => { const w = String(args).split(/\s+/); return [w[0].split("/").pop(), ...w.slice(1, 3)].join(" ").slice(0, 40); };
  const out = [];
  for (const a of local) {
    let info = null;
    try { info = JSON.parse((await hc(["get", a, "--json"])).stdout); } catch {}
    if (!info?.pid || info.state === "exited") continue;
    const fg = info.foreground;
    if (fg?.pid && fg.pid !== info.pid) out.push(short((fg.argv ?? []).join(" ") || fg.name));
    for (const c of kids.get(info.pid) ?? []) if (c.pid !== fg?.pid && !HELPER.test(c.args)) out.push(short(c.args));
  }
  return [...new Set(out)];
}

// One dialog at a time, across both mods: a held key or the other mod's close replaces it rather than
// stacking another. Shared, as each mod has its own copy of this file; ks-confirm clears it on closing.
const OPEN = "ks-confirm.open";

// `kind`'s choice decides. `never`: runs `command` at once, a space with its last tab too. `agents` ("while something
// runs"): asks while an agent is in it or a program runs in one of `terms` (a dev server, a build, a background job),
// otherwise runs Herdr's own close (`command` without `confirmed`), which still asks before a space goes.
// `always`: asks every time. `ends` says what closing ends when nothing runs, `more` what else goes;
// with neither, the dialog says nothing runs in it.
async function closeAsking({ kind, agents, terms = [], title, ends, more, command }) {
  const mode = confirmMode(kind);
  const procs = mode === "never" ? [] : await running(terms, new Set(agents.map(a => a.address)));
  // ks: a tab isn't closed at once but put away for 30 s with Undo (lib/closing.js); its space too when it's the last.
  const soft = command.name === "tab.close" ? { kind: "tab", id: command.args.id } : null;
  const now = () => soft ? closing.closeTab(soft.id) : run(command.name, command.args);
  if (mode === "never") return now();
  if (mode === "agents" && agents.length === 0 && procs.length === 0) {
    if (soft) return now();
    const { confirmed, ...args } = command.args;
    return run(command.name, args);
  }
  const names = [...new Set(agents.map(a => a.program?.name ?? a.app ?? "An agent"))].join(", ");
  const list = procs.slice(0, 3).join(", ") + (procs.length > 3 ? ` and ${procs.length - 3} more` : "");
  const why = [agents.length === 0 ? "" : agents.length === 1 ? `${names} is running in it.` : `${agents.length} agents are running in it (${names}).`,
    procs.length ? `Still running: ${list}.` : "", agents.length || procs.length ? "Closing ends them." : ends].filter(Boolean).join(" ");
  if (shared(OPEN)) closeOverlay(shared(OPEN));
  const detail = [why, more, soft ? `You can undo for ${Math.round(closing.grace() / 1000)} s.` : ""].filter(Boolean).join(" ") || "Nothing runs in it.";
  setShared(OPEN, openOverlay({ mod: "ks-confirm", kind: "dialog", width: 420, height: procs.length && agents.length ? 200 : 170,
    props: { title, detail, command, soft } }));
}

export function closeTab(id) {
  const space = spaces().find(s => s.tabs.some(c => c.id === id));
  if (!space) return;
  const tab = space.tabs.find(c => c.id === id), name = tabName(tab);
  closeAsking({
    kind: "tab",
    // Sub-agents belong to their parent's tab, and closing the tab ends them as well.
    agents: busy(a => a.tab === id),
    terms: panes().filter(p => p.tab === id).map(p => p.terminal),
    title: tab.named ? `Close tab "${fit(name)}"?` : `Close tab ${fit(name)}?`,
    ends: panes().some(p => p.tab === id && p.terminal) ? "Its terminals end." : "",
    more: space.tabs.filter(c => !closing.hiddenTab(c.id)).length === 1 ? "It's the space's last tab, so the space closes too." : "",
    command: { name: "tab.close", args: { id, confirmed: true } },
  });
}

// A pane's name, as ks-pane's header shows it and its rename dialog sets it. herdr-core can't
// rename a running terminal, so a terminal's name is its label; a mod pane's is in shared state.
export const NAME_LABEL = "ks-pane.name";
export const NAMES = "ks-pane.names";

// The name someone gave the pane, or "".
export function givenName(p) {
  if (p.terminal) return terminals().find(t => t.address === p.terminal)?.labels?.[NAME_LABEL] ?? "";
  return shared(NAMES)?.[p.pane] ?? "";
}

export const fallbackName = (p) => ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";

// Its given name, else the program's.
export const paneName = (p) => givenName(p) || fallbackName(p);

// A tab's only pane takes the tab with it, so closing it closes the tab, and asks as closing a tab
// does: a pane's × shouldn't end a tab more quietly than cmd-w would. (tab.close, too: pane.close
// has no `confirmed` and asks before a space goes anyway.)
// cmd-shift-w comes through ks-tabs, not the pane headers: a key command reaches every shown
// copy, and each header checking focus in turn would close one pane after the other as focus moves.
export function closePane(pane) {
  const all = panes(), p = all.find(q => q.pane === pane);
  if (!p) return;
  const name = paneName(p);
  const lone = all.filter(q => q.tab === p.tab).length === 1;
  const last = lone && spaces().find(s => s.tabs.some(c => c.id === p.tab))?.tabs.length === 1;
  // Its terminal's sub-agents (and theirs) end with it; a lone pane's tab takes every agent in the tab.
  const parent = new Map(terminals().map(t => [t.address, t.parent]));
  const under = (address) => {
    for (let a = parent.get(address), seen = new Set(); a && !seen.has(a); seen.add(a), a = parent.get(a))
      if (a === p.terminal) return true;
    return false;
  };
  const close = lone ? { name: "tab.close", args: { id: p.tab, confirmed: true } } : { name: "pane.close", args: { pane } };
  closeAsking({
    kind: lone ? "tab" : "pane",
    agents: busy(a => lone ? a.tab === p.tab : a.pane === pane || (p.terminal && under(a.address))),
    terms: lone ? all.filter(q => q.tab === p.tab).map(q => q.terminal) : [p.terminal],
    title: `Close pane "${fit(name)}"?`,
    ends: p.terminal ? "Its terminal ends." : "",
    more: last ? "It's the space's last pane, so the space closes too." : lone ? "It's the tab's only pane, so the tab closes too." : "",
    command: close,
  });
}
