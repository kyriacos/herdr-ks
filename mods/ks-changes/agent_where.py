"""Where a Claude Code agent is working: the git checkouts it touched last.

Usage: python3 -I agent_where.py <pid>
Prints JSON: {"roots": [checkout, ...] (most recent first, at most 3), "cwd": its recorded folder, "log": the log read}

Claude Code resets its shell to the launch folder when a `cd` leaves it, so the recorded `cwd` stays the
launch folder while the agent edits other worktrees by absolute path. The signals that do follow the work:
files it edits or writes, and folders its shell commands `cd` or `git -C` into.
"""
import glob
import json
import os
import re
import shlex
import sys

HOME = os.path.expanduser("~")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
CD = re.compile(r"(?:^|&&|\|\||;|\()\s*cd\s+((?:\"[^\"]+\"|'[^']+'|[^\s;&|)]+))")
GIT_C = re.compile(r"\bgit\s+-C\s+((?:\"[^\"]+\"|'[^']+'|[^\s;&|)]+))")
TAIL = 40_000_000  # bytes of the log read, from the end (a whole session, in practice)
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


def main():
    pid = sys.argv[1]
    log, launch = log_of(pid)
    out = {"roots": [], "cwd": launch, "log": log}
    if not log:
        print(json.dumps(out))
        return
    with open(log, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - TAIL))
        lines = f.read().decode("utf-8", "replace").splitlines()[1 if size > TAIL else 0:]
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
    out["cwd"] = cwd
    # Every checkout it edited in this session, plus where its recent commands went (reading around counts
    # only while recent). Most recently active first; worktrees of the same repo each count.
    last = {}
    nav_from = max(0, len([s for s in signals if s[2] == "nav"]) - RECENT)
    nav_seen = 0
    tops = {}
    edited = set()
    for i, (path, base, kind) in enumerate(signals):
        if kind == "nav":
            nav_seen += 1
            if nav_seen <= nav_from:
                continue
        key = (path, base)
        if key not in tops:
            tops[key] = top_of(path, base)
        top = tops[key]
        if top:
            last[top.lower()] = (i, top)
            if kind == "edit":
                edited.add(top.lower())
    seen = [top for _, top in sorted(last.values(), reverse=True)][:MAX_ROOTS]
    # An agent started in a repo's main checkout that works in one of its worktrees: main is only where it was
    # started (Claude Code keeps going back there), so it's left out unless the agent edited files in it.
    worktree_repos = {repo_of(t) for t in seen if repo_of(t) != t.lower()}
    seen = [t for t in seen if not (repo_of(t) == t.lower() and t.lower() in worktree_repos and t.lower() not in edited)]
    if not seen:
        top = top_of(cwd, None)
        if top:
            seen.append(top)
    out["roots"] = seen
    print(json.dumps(out))


if __name__ == "__main__":
    main()
