"""The last Claude Code session of a terminal, drawn as a card inside it, with resume on Enter.

Usage: python3 -I last_session.py <sessionId> <cwd> [<seconds since it last ran>]
The tab bar (ks-tabs) types this into a terminal that came back as a plain shell after a reboot. It prints what
the session was (title, folder, branch, when, prompts, Claude's last reply, files it edited) and waits for a key:
Enter resumes it (`claude --resume <id>` in its folder), p picks another session there, anything else leaves the
shell as it is.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import termios
import textwrap
import tty

HOME = os.path.expanduser("~")
EDITS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def read(log):
    info = {"title": None, "prompts": [], "reply": None, "files": []}
    custom = ai = None
    with open(log, "rb") as f:
        for raw in f:
            if not (b'"user"' in raw or b'"assistant"' in raw or b'-title"' in raw):
                continue
            try:
                e = json.loads(raw)
            except Exception:
                continue
            kind = e.get("type")
            if kind == "custom-title":
                custom = e.get("customTitle") or custom
            elif kind == "ai-title":
                ai = e.get("aiTitle") or ai
            elif kind == "user" and not e.get("isSidechain") and not e.get("isMeta"):
                t = text_of((e.get("message") or {}).get("content")).strip()
                t = re.sub(r"<hc [^>]*>|</hc>", "", t).strip()
                if t and not t.startswith("<"):
                    info["prompts"].append(" ".join(t.split()))
            elif kind == "assistant" and not e.get("isSidechain"):
                content = (e.get("message") or {}).get("content") or []
                t = text_of(content).strip()
                if t:
                    info["reply"] = t
                for c in content if isinstance(content, list) else []:
                    if c.get("type") == "tool_use" and c.get("name") in EDITS:
                        p = (c.get("input") or {}).get("file_path") or (c.get("input") or {}).get("notebook_path")
                        if p:
                            if p in info["files"]:
                                info["files"].remove(p)
                            info["files"].append(p)
    info["title"] = custom or ai
    return info


def short(path):
    return "~" + path[len(HOME):] if path == HOME or path.startswith(HOME + "/") else path


def ago(seconds):
    s = max(0, seconds)
    if s < 90:
        return "just now"
    if s < 3600:
        return f"{round(s / 60)} min ago"
    if s < 86400:
        return f"{round(s / 3600)} h ago"
    return f"{round(s / 86400)} days ago"


def branch(cwd):
    try:
        r = subprocess.run(["git", "-C", cwd, "branch", "--show-current"], capture_output=True, text=True, timeout=2)
        return r.stdout.strip() or None
    except Exception:
        return None


def key():
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        return sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def main(sid, cwd, since=None):
    log = f"{HOME}/.claude/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}/{sid}.jsonl"
    if not os.path.exists(log):
        print(f"Claude session {sid} isn't on this machine any more.")
        return
    info = read(log)
    seconds = float(since) if since else __import__("time").time() - os.path.getmtime(log)
    width = min(100, shutil.get_terminal_size((100, 30)).columns - 4)
    dim, bold, accent, reset = "\033[2m", "\033[1m", "\033[36m", "\033[0m"
    bar = "─" * width

    def para(label, text, lines=3):
        if not text:
            return
        wrapped = textwrap.wrap(" ".join(text.split()), width - 2)
        more = len(wrapped) > lines
        print(f"{dim}{label}{reset}")
        for line in wrapped[:lines]:
            print(f"  {line}")
        if more:
            print(f"  {dim}…{reset}")

    title = info["title"] or (info["prompts"][0][:70] if info["prompts"] else f"session {sid[:8]}")
    br = branch(cwd)
    print(f"\n{accent}{bar}{reset}")
    print(f"{bold}↻ Last Claude session here:{reset} {bold}{title}{reset}")
    meta = [short(cwd)] + ([f"branch {br}"] if br else []) + [f"ran {ago(seconds)}", f"{len(info['prompts'])} prompts"]
    print(f"{dim}{'  ·  '.join(meta)}{reset}\n")
    if info["prompts"]:
        para("Started with", info["prompts"][0], 2)
        if len(info["prompts"]) > 1:
            para("Last asked", info["prompts"][-1], 2)
    para("Claude's last reply", info["reply"], 4)
    if info["files"]:
        files = [short(p) for p in info["files"][-6:]][::-1]
        extra = len(info["files"]) - len(files)
        print(f"{dim}Files it edited{reset}")
        for p in files:
            print(f"  {p}")
        if extra > 0:
            print(f"  {dim}and {extra} more{reset}")
    print(f"{accent}{bar}{reset}")
    print(f"{bold}Enter{reset} resume   {bold}p{reset} pick another session   {dim}any other key: keep the shell{reset}")
    sys.stdout.flush()
    try:
        k = key()
    except Exception:
        return
    if k in ("\r", "\n"):
        os.chdir(cwd)
        os.execvp("claude", ["claude", "--resume", sid])
    elif k in ("p", "P"):
        os.chdir(cwd)
        os.execvp("claude", ["claude", "--resume"])
    print()


if __name__ == "__main__":
    main(*sys.argv[1:4])
