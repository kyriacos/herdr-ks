// ks: the processes running under an agent, for the Agents list's "N procs" chip. Herdr's core (`hc get`) names the
// agent's own process (the terminal's foreground pid); `ps` gives everything under it, `lsof` the ports they listen on.
//
// What's shown, per agent, as items:
//   - a tool shell (Claude Code runs each command as `zsh -c … eval '<command>'`): one item, named by its command,
//     with the CPU and ports of everything under it;
//   - any other direct child (a dev server the agent started some other way): one item likewise;
//   - MCP servers: one folded item ("MCP servers · 3"), they run for the whole session;
//   - caffeinate (Claude keeping the Mac awake): left out.
// Pure parsing is split from the exec calls so it reads (and tests) on its own.
import { exec, hc } from "herdr";

// `ps -Ao pid=,ppid=,etime=,pcpu=,args=` -> Map pid -> { pid, ppid, etime, cpu, args }.
export function parsePs(out) {
  const m = new Map();
  for (const line of String(out ?? "").split("\n")) {
    const r = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (r) m.set(Number(r[1]), { pid: Number(r[1]), ppid: Number(r[2]), etime: r[3], cpu: Number(r[4]), args: r[5] });
  }
  return m;
}

// `lsof -nP -iTCP -sTCP:LISTEN -Fpn` -> Map pid -> [port].
export function parseLsof(out) {
  const m = new Map();
  let pid = null;
  for (const line of String(out ?? "").split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) {
      const port = Number(/:(\d+)$/.exec(line)?.[1]);
      if (port) { const l = m.get(pid) ?? []; if (!l.includes(port)) l.push(port); m.set(pid, l); }
    }
  }
  return m;
}

// The command a Claude Code tool shell runs: the `eval '…'` part, unquoted ('"'"' is a quote inside).
export function toolCommand(args) {
  const r = /&& eval ('(?:[^']|'"'"')*')/.exec(args);
  if (!r) return null;
  return r[1].slice(1, -1).replaceAll(`'"'"'`, "'").replace(/\s*\\?<\s*\/dev\/null\s*$/, "").trim();
}

// "02-03:04:05" / "03:04:05" / "04:05" -> seconds.
export function seconds(etime) {
  const [d, rest] = String(etime).includes("-") ? etime.split("-") : [0, etime];
  return rest.split(":").map(Number).reduce((a, b) => a * 60 + b, 0) + Number(d) * 86400;
}

// A short name for a process's command line: its program and first few arguments, paths trimmed.
export function shortArgs(args) {
  const parts = String(args).split(/\s+/).filter(Boolean);
  const prog = (parts[0] ?? "").split("/").pop();
  const rest = parts.slice(1).map((p) => (p.startsWith("/") && p.split("/").length > 3 ? "…/" + p.split("/").slice(-2).join("/") : p));
  return [prog, ...rest].join(" ").slice(0, 160);
}

// A command for one line: its first line (ps writes newlines as \012), no output redirection, no trailing &, and no
// launcher in front ("uv run --env-file=.env uvicorn …" -> "uvicorn …", "pnpm exec next dev" -> "next dev").
const LAUNCHER = /^(?:(?:uv|poetry|pipenv|bundle|cargo)\s+(?:run|exec)|(?:pnpm|npm|yarn|bun)\s+exec|npx|bunx|exec|env(?:\s+\w+=\S+)*)\s+(?:--?[\w-]+(?:=\S+)?\s+)*/;
export function tidy(cmd) {
  const line = String(cmd).replace(/\\012/g, "\n").split("\n")[0]
    .replace(/\s*(?:\d?>>?|&>)\s*(?:&\d|\S+)/g, "").replace(/\s*&\s*$/, "").replace(/\s+/g, " ").trim();
  const bare = line.replace(LAUNCHER, "");
  return (bare || line).slice(0, 160);
}

// The items under `root` (the agent's pid).
export function itemsUnder(root, ps, ports) {
  const kids = new Map();
  for (const p of ps.values()) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p);
  const below = (pid) => { const out = [], stack = [...(kids.get(pid) ?? [])]; while (stack.length) { const p = stack.pop(); out.push(p); stack.push(...(kids.get(p.pid) ?? [])); } return out; };
  const items = [], mcp = [];
  for (const c of kids.get(root) ?? []) {
    if (/^caffeinate\b|\/caffeinate\b/.test(c.args)) continue;
    const all = [c, ...below(c.pid)];
    if (/mcp|modelcontextprotocol/i.test(c.args)) { mcp.push(c); continue; }
    let cmd = toolCommand(c.args), where = null;
    // "cd <folder> && npm run dev": the folder goes to its own tag, the command keeps what it runs.
    const cd = cmd && /^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*(.+)$/s.exec(cmd);
    if (cd) { where = cd[1].replace(/^["']|["']$/g, "").replace(/\/+$/, "").split("/").pop(); cmd = cd[2].trim(); }
    const listen = [...new Set(all.flatMap((p) => ports.get(p.pid) ?? []))].sort((a, b) => a - b);
    items.push({ pid: c.pid, pids: all.map((p) => p.pid), label: cmd ? tidy(cmd) : shortArgs(c.args), where, tool: Boolean(cmd),
      secs: seconds(c.etime), cpu: Math.round(all.reduce((n, p) => n + p.cpu, 0)), ports: listen, count: all.length });
  }
  items.sort((a, b) => b.ports.length - a.ports.length || a.secs - b.secs);
  if (mcp.length) items.push({ pid: null, pids: mcp.flatMap((c) => [c.pid, ...below(c.pid).map((p) => p.pid)]), label: "MCP servers", mcp: mcp.map((c) => shortArgs(c.args)),
    secs: Math.max(...mcp.map((c) => seconds(c.etime))), cpu: 0, ports: [], count: mcp.length });
  return items;
}

// { [address]: items } for the given agents (local ones only: a remote agent's processes are on its machine).
// `pids`: a cache address -> { pid, at } kept by the caller, so `hc get` runs once a minute per agent.
export async function readProcs(addresses, pids, withPorts) {
  const local = addresses.filter((a) => !a.includes("/"));
  for (const a of local) {
    const hit = pids[a];
    if (hit && Date.now() - hit.at < 60000) continue;
    const r = await hc(["get", a]).catch(() => null);
    let pid = null; try { pid = JSON.parse(r.stdout).foreground?.pid ?? null; } catch {}
    pids[a] = { pid, at: Date.now() };
  }
  const ps = await exec("ps", ["-Ao", "pid=,ppid=,etime=,pcpu=,args="], { timeout: 5000 }).catch(() => null);
  if (!ps || ps.code !== 0) return null;
  const lsof = withPorts ? await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { timeout: 5000 }).catch(() => null) : null;
  const table = parsePs(ps.stdout), ports = parseLsof(lsof?.stdout ?? "");
  const out = {};
  for (const a of local) { const pid = pids[a]?.pid; if (pid && table.has(pid)) out[a] = itemsUnder(pid, table, ports); }
  return out;
}

// Stops an item: TERM to its processes, deepest first.
export async function stop(item) {
  const pids = [...item.pids].reverse().map(String);
  if (pids.length) await exec("kill", ["-TERM", ...pids]).catch(() => null);
}
