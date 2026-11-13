"""Which Claude Code session a running agent is in, so it can be resumed after its terminal is lost.

Usage: python3 -I session_of.py <pid> [<pid> ...]
Prints JSON: {"<pid>": {"sessionId", "cwd" (the folder Claude was started in: resume runs there), "title"}, ...}
A pid that isn't a Claude Code session, or whose session has no conversation yet, is left out.

~/.claude/sessions/<pid>.json names the session; when its log is missing (resumed or cleared), the newest log in
the project folder that no other live session owns is taken, as in ks-changes/agent_where.py.
The title: the last /rename (custom-title), else the last title Claude gave it (ai-title), else the first prompt.
"""
import glob
import json
import os
import re
import sys

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


def main(pids):
    out = {}
    for pid in pids:
        sess = load(f"{HOME}/.claude/sessions/{pid}.json")
        if not sess or not sess.get("sessionId") or not sess.get("cwd"):
            continue
        log = log_of(pid, sess)
        if not log:
            continue  # nothing said yet: nothing to resume
        sid = os.path.basename(log)[:-6]
        try:
            title = title_of(log)
        except Exception:
            title = None
        out[str(pid)] = {"sessionId": sid, "cwd": sess["cwd"], "title": title or sess.get("name")}
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1:])
