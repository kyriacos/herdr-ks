"""Where an agent is working: the git checkouts it touched last.

Usage: python3 -I agent_where.py <pid>
Prints JSON: {"roots": [checkout, ...] (most recent first), "touched": [checkout, ...] (every one it edited or
went into this session, most recent first: the PRs panel looks for their pull requests), "cwd": its recorded
folder, "log": the log read, "agent": "claude" | "codex" | "other"}

Claude Code and Codex: read from the session log (below). Any other agent: the folders its process and the
commands it runs are in right now, which follows it only while it works there.

Claude Code resets its shell to the launch folder when a `cd` leaves it, so the recorded `cwd` stays the
launch folder while the agent edits other worktrees by absolute path. The signals that do follow the work:
files it edits or writes, and folders its shell commands `cd` or `git -C` into.
"""
import glob
import json
import os
import re
import shlex
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
CD = re.compile(r"(?:^|&&|\|\||;|\()\s*cd\s+((?:\"[^\"]+\"|'[^']+'|[^\s;&|)]+))")
GIT_C = re.compile(r"\bgit\s+-C\s+((?:\"[^\"]+\"|'[^']+'|[^\s;&|)]+))")
TAIL = 40_000_000  # bytes of the log read, from the end (a whole session, in practice)
PATCH = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.M)
RECENT = 12        # navigation signals (cd, git -C) that count, from the end
MAX_ROOTS = 10


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def log_of(pid):
    sess = load(f"{HOME}/.claude/sessions/{pid}.json")
    if not sess:
        return None, None
    folder = f"{HOME}/.claude/projects/{re.sub(r'[^A-Za-z0-9]', '-', sess['cwd'])}"
    log = f"{folder}/{sess['sessionId']}.jsonl"
    if os.path.exists(log):
        return log, sess["cwd"]
    # Resumed or cleared: the session file keeps the first id. Take the newest log in its project
    # folder that no other live Claude session owns.
    others = set()
    for f in glob.glob(f"{HOME}/.claude/sessions/*.json"):
        s = load(f)
        if s and str(s.get("pid")) != str(pid) and s.get("sessionId"):
            others.add(s["sessionId"])
    logs = [p for p in glob.glob(f"{folder}/*.jsonl") if os.path.basename(p)[:-6] not in others]
    return (max(logs, key=os.path.getmtime) if logs else None), sess["cwd"]


# ---------- other agents ----------
ROLLOUT = re.compile(r"/rollout-[^/]*\.jsonl$")


def sh(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=8).stdout
    except Exception:
        return ""


def family(pid):
    """The pid and every process under it (an agent's command is often a wrapper around the real program)."""
    kids = {}
    for line in sh(["ps", "-axo", "pid=,ppid="]).splitlines():
        parts = line.split()
        if len(parts) == 2:
            kids.setdefault(parts[1], []).append(parts[0])
    out, todo = [], [str(pid)]
    while todo and len(out) < 200:
        p = todo.pop(0)
        out.append(p)
        todo.extend(kids.get(p, []))
    return out


def cwds(pids):
    """Each process's folder, in the order given (lsof prints p<pid> then n<folder>)."""
    found, pid = {}, None
    for line in sh(["lsof", "-a", "-d", "cwd", "-Fn", "-p", ",".join(pids)]).splitlines():
        if line.startswith("p"):
            pid = line[1:]
        elif line.startswith("n") and pid:
            found[pid] = line[1:]
    return [found[p] for p in pids if p in found]


def codex_log(pids, folders):
    """The Codex session log (rollout-*.jsonl) of these processes: the one they hold open, else the newest of
    the last days that was started in one of their folders."""
    for line in sh(["lsof", "-Fn", "-p", ",".join(pids)]).splitlines():
        if line.startswith("n") and ROLLOUT.search(line):
            return line[1:]
    root = os.path.join(os.environ.get("CODEX_HOME") or f"{HOME}/.codex", "sessions")
    logs = sorted(glob.glob(f"{root}/*/*/*/rollout-*.jsonl"), key=os.path.getmtime, reverse=True)[:30]
    for log in logs:
        if time.time() - os.path.getmtime(log) > 2 * 86400:
            break
        meta = codex_meta(log)
        if meta.get("cwd") and meta["cwd"] in folders:
            return log
    return None


def codex_meta(log):
    """{"id", "cwd"} from the log's first lines (its session_meta)."""
    try:
        with open(log, "rb") as f:
            for _ in range(5):
                raw = f.readline()
                if not raw:
                    break
                try:
                    e = json.loads(raw)
                except Exception:
                    continue
                p = e.get("payload") if isinstance(e.get("payload"), dict) else e
                if p.get("id") and p.get("cwd"):
                    return {"id": p["id"], "cwd": p["cwd"]}
    except Exception:
        pass
    return {}


def unquote(s):
    try:
        return shlex.split(s)[0]
    except Exception:
        return s.strip("\"'")


def top_of(path, base):
    if not path:
        return None
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.join(base or HOME, path)
    path = os.path.normpath(path)
    d = path if os.path.isdir(path) else os.path.dirname(path)
    while d and d != "/":
        if os.path.exists(os.path.join(d, ".git")):
            return d
        d = os.path.dirname(d)
    return None


def repo_of(top):
    """The repo a checkout belongs to: its own folder for a main checkout, else the main .git a worktree points at."""
    g = os.path.join(top, ".git")
    if os.path.isfile(g):
        try:
            with open(g) as f:
                gitdir = f.read().strip().removeprefix("gitdir:").strip()
            return gitdir.split("/.git/")[0].lower()
        except Exception:
            pass
    return top.lower()


def tail(log):
    with open(log, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - TAIL))
        return f.read().decode("utf-8", "replace").splitlines()[1 if size > TAIL else 0:]


def claude_signals(lines, launch):
    signals, cwd = [], launch
    for line in lines:
        try:
            m = json.loads(line)
        except Exception:
            continue
        cwd = m.get("cwd") or cwd
        content = (m.get("message") or {}).get("content")
        if m.get("type") != "assistant" or not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "tool_use":
                continue
            name, inp = part.get("name"), part.get("input") or {}
            if name in EDIT_TOOLS:
                signals.append((inp.get("file_path") or inp.get("notebook_path"), cwd, "edit"))
            elif name == "Bash":
                cmd = inp.get("command") or ""
                for rx in (CD, GIT_C):
                    for t in rx.findall(cmd):
                        signals.append((unquote(t), cwd, "nav"))
    return signals, cwd


def codex_signals(lines, launch):
    """Codex's tool calls: the folder a command runs in (workdir), where it `cd`s or `git -C`s, and the files
    its patches name. Read loosely (any call with arguments), as the call names changed between versions."""
    signals, cwd = [], launch
    for line in lines:
        try:
            e = json.loads(line)
        except Exception:
            continue
        p = e.get("payload") if isinstance(e.get("payload"), dict) else e
        if isinstance(p.get("cwd"), str) and p["cwd"]:
            cwd = p["cwd"]
        if not str(p.get("type", "")).endswith("_call"):
            continue
        args = p.get("arguments") or p.get("input") or p.get("action") or {}
        text = args if isinstance(args, str) else ""
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}
        base = args.get("workdir") or args.get("working_directory") or args.get("cwd") or cwd
        if base != cwd:
            signals.append((base, cwd, "nav"))
        cmd = args.get("command") or args.get("cmd") or ""
        if isinstance(cmd, list):
            cmd = " ".join(str(c) for c in cmd)
        text = f"{cmd}\n{args.get('input') or args.get('patch') or ''}\n{text}"
        for t in PATCH.findall(text):
            signals.append((t.strip(), base, "edit"))
        for rx in (CD, GIT_C):
            for t in rx.findall(str(cmd)):
                signals.append((unquote(t), base, "nav"))
    return signals, cwd


def main():
    pid = sys.argv[1]
    log, launch = log_of(pid)
    out = {"roots": [], "cwd": launch, "log": log, "agent": "claude"}
    signals, cwd = [], launch
    if log:
        signals, cwd = claude_signals(tail(log), launch)
    elif launch is None:
        # Not Claude Code. Codex has a session log too; anything else is followed by where its processes are.
        pids = family(pid)
        folders = cwds(pids)
        launch = cwd = folders[0] if folders else None
        log = codex_log(pids, set(folders))
        out.update({"log": log, "agent": "codex" if log else "other"})
        if log:
            launch = codex_meta(log).get("cwd") or launch
            signals, cwd = codex_signals(tail(log), launch)
        # No log, or nothing in it yet: where its processes are now. A command's folder (a process further down)
        # is listed after the agent's own, so it counts as the more recent one.
        if not signals:
            signals = [(f, None, "edit") for f in folders]
    else:
        print(json.dumps(out))
        return
    out["cwd"] = cwd
    # Every checkout it edited in this session, plus where its recent commands went (reading around counts
    # only while recent). Most recently active first; worktrees of the same repo each count.
    last, every = {}, {}
    nav_from = max(0, len([s for s in signals if s[2] == "nav"]) - RECENT)
    nav_seen = 0
    tops = {}
    for i, (path, base, kind) in enumerate(signals):
        key = (path, base)
        if key not in tops:
            tops[key] = top_of(path, base)
        top = tops[key]
        if top:
            every[top.lower()] = (i, top)
        if kind == "nav":
            nav_seen += 1
            if nav_seen <= nav_from:
                continue
        if top:
            last[top.lower()] = (i, top)
    seen = [top for _, top in sorted(last.values(), reverse=True)][:MAX_ROOTS]
    if not seen:
        top = top_of(cwd, None)
        if top:
            seen.append(top)
    out["roots"] = seen
    out["touched"] = [top for _, top in sorted(every.values(), reverse=True)][:MAX_ROOTS] or seen
    print(json.dumps(out))


if __name__ == "__main__":
    main()
