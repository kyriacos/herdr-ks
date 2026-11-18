"""Which session a running agent is in, so it can be resumed after its terminal is lost. Claude Code and Codex.

Usage: python3 -I session_of.py <pid> [<pid> ...]
Prints JSON: {"<pid>": {"sessionId", "cwd" (the folder the agent was started in: resume runs there), "title",
"app": "claude" | "codex"}, ...}
A pid that is neither, or whose session has no conversation yet, is left out.

~/.claude/sessions/<pid>.json names the session; when its log is missing (resumed or cleared), the newest log in
the project folder that no other live session owns is taken, as in ks-changes/agent_where.py.
The title: the last /rename (custom-title), else the last title Claude gave it (ai-title), else the first prompt.
"""
import glob
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser("~")


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def log_of(pid, sess):
    folder = f"{HOME}/.claude/projects/{re.sub(r'[^A-Za-z0-9]', '-', sess['cwd'])}"
    log = f"{folder}/{sess['sessionId']}.jsonl"
    if os.path.exists(log):
        return log
    others = set()
    for f in glob.glob(f"{HOME}/.claude/sessions/*.json"):
        s = load(f)
        if s and str(s.get("pid")) != str(pid) and s.get("sessionId"):
            others.add(s["sessionId"])
    # Only a log written since this process started can be its conversation; a new session has none yet.
    since = (sess.get("startedAt") or 0) / 1000 - 5
    logs = [p for p in glob.glob(f"{folder}/*.jsonl")
            if os.path.basename(p)[:-6] not in others and os.path.getmtime(p) >= since]
    return max(logs, key=os.path.getmtime) if logs else None


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def title_of(log):
    custom = ai = first = None
    with open(log, "rb") as f:
        for raw in f:
            if b'"custom-title"' in raw or b'"ai-title"' in raw:
                try:
                    e = json.loads(raw)
                except Exception:
                    continue
                if e.get("type") == "custom-title" and e.get("customTitle"):
                    custom = e["customTitle"]
                elif e.get("type") == "ai-title" and e.get("aiTitle"):
                    ai = e["aiTitle"]
            elif first is None and b'"type":"user"' in raw:
                try:
                    e = json.loads(raw)
                except Exception:
                    continue
                t = text_of((e.get("message") or {}).get("content")).strip()
                if t and not t.startswith("<"):
                    first = " ".join(t.split())[:80]
    return custom or ai or first


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


def codex_title(log):
    """The first thing the person asked."""
    try:
        with open(log, "rb") as f:
            for n, raw in enumerate(f):
                if n > 400:
                    break
                if b'"user"' not in raw:
                    continue
                try:
                    e = json.loads(raw)
                except Exception:
                    continue
                p = e.get("payload") if isinstance(e.get("payload"), dict) else e
                if p.get("role") != "user":
                    continue
                t = " ".join(c.get("text", "") for c in p.get("content") or [] if isinstance(c, dict)).strip()
                if t and not t.startswith("<"):
                    return " ".join(t.split())[:80]
    except Exception:
        pass
    return None


def codex_session(pid):
    pids = family(pid)
    log = codex_log(pids, set(cwds(pids)))
    meta = codex_meta(log) if log else {}
    title = codex_title(log) if meta else None
    if not meta or not title:
        return None  # nothing said yet: nothing to resume
    return {"sessionId": meta["id"], "cwd": meta["cwd"], "title": title, "app": "codex"}


def main(pids):
    out = {}
    for pid in pids:
        sess = load(f"{HOME}/.claude/sessions/{pid}.json")
        if not sess:
            found = codex_session(pid)
            if found:
                out[str(pid)] = found
            continue
        if not sess.get("sessionId") or not sess.get("cwd"):
            continue
        log = log_of(pid, sess)
        if not log:
            continue  # nothing said yet: nothing to resume
        sid = os.path.basename(log)[:-6]
        try:
            title = title_of(log)
        except Exception:
            title = None
        out[str(pid)] = {"sessionId": sid, "cwd": sess["cwd"], "title": title or sess.get("name"), "app": "claude"}
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1:])
