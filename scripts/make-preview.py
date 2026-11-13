#!/usr/bin/env python3
"""Draws layouts/ks.svg, the picture Herdr's settings show for the ks layout.

Everything in it is made up (repos acme/api and acme/web, the PRs, the agents, the code); the arrangement is the
ks layout's: the sidebar (brand, My PRs, spaces, agents), the tab bar, split panes with their headers, the side
panel (Changes), the status bar and the service mode's key strip. Run: python3 scripts/make-preview.py
"""
from pathlib import Path
from html import escape

W, H = 1920, 1200
C = dict(  # a light theme, as the ks layout shows it
    canvas="#f1efe6", chrome="#ece9df", bg="#fffdf4", raised="#f6f3e9", border="#d3cfc3", text="#2b2a26",
    muted="#6f6b61", dim="#9b968a", accent="#2f62b0", green="#3d8b3d", red="#c0453a", amber="#b7791f",
    hover="#e6e2d6", greenbg="#e3f1dc", redbg="#f8e1dd",
)
UI = "Geist, Helvetica Neue, Helvetica, Arial, sans-serif"
MONO = "JetBrains Mono, Menlo, monospace"
out = []


def rect(x, y, w, h, fill, rx=0, stroke=None, sw=1, op=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    o = f' opacity="{op}"' if op is not None else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{s}{o}/>')


def text(x, y, s, size=13, fill=None, weight=400, font=UI, anchor="start"):
    out.append(f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" '
               f'fill="{fill or C["text"]}" text-anchor="{anchor}" xml:space="preserve">{escape(s)}</text>')


def line(x1, y1, x2, y2, color=None, w=1):
    out.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{color or C["border"]}" stroke-width="{w}"/>')


def pill(x, y, label, color, size=10.5, filled=False):
    w = len(label) * size * 0.58 + 12
    rect(x, y, w, 17, color if filled else "none", rx=8, stroke=None if filled else color)
    text(x + w / 2, y + 12.5, label, size, C["bg"] if filled else color, 500, anchor="middle")
    return w


# --- window ---
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
out.append(f'<defs><clipPath id="win"><rect width="{W}" height="{H}" rx="12"/></clipPath></defs><g clip-path="url(#win)">')
rect(0, 0, W, H, C["canvas"])

# --- sidebar ---
SB = 268
rect(0, 0, SB, H, C["chrome"])
line(SB + 0.5, 0, SB + 0.5, H)
for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
    out.append(f'<circle cx="{18 + 20 * i}" cy="22" r="6" fill="{c}"/>')
rect(80, 12, 22, 22, C["accent"], rx=6)
text(91, 27.5, "ks", 11, C["bg"], 700, anchor="middle")
text(110, 22, "herdr-ks", 13, weight=600)
text(110, 36, "your layout", 11, C["dim"])

y = 64
text(14, y, "▾  My PRs", 12, C["muted"]); text(84, y, "3", 11, C["dim"]); pill(98, y - 12, "1 needs you", C["red"], 10, True)
prs = [
    ("api#412", "Rate-limit the public endpoints", [("✓ CI", C["green"]), ("✓ approved", C["green"]), ("ready", C["green"])], C["green"]),
    ("web#88", "Dark mode toggle in settings", [("◌ CI 2", C["amber"]), ("review", C["muted"]), ("blocked", C["muted"])], C["amber"]),
    ("api#409", "Fix invoice rounding to 2 dp", [("✕ CI 1", C["red"]), ("✕ changes", C["red"]), ("behind", C["amber"])], C["red"]),
]
y += 14
for ref, title, steps, mark in prs:
    rect(8, y, SB - 16, 46, C["bg"] if ref == "api#412" else C["chrome"], rx=7)
    rect(8, y + 4, 2, 38, mark)
    text(18, y + 17, ref, 11.5, C["dim"]); text(18 + len(ref) * 7 + 6, y + 17, title, 11.5)
    x = 18
    for label, col in steps:
        x += pill(x, y + 24, label, col, 9.5) + 4
    y += 50

y += 18
text(14, y, "Spaces", 12, C["muted"])
y += 10
for i, (name, col, badge, active) in enumerate([("api", "#2f62b0", "2", True), ("web", "#b0452f", "1", False), ("docs", "#3d8b3d", "", False)]):
    if active:
        rect(8, y, SB - 16, 28, C["hover"], rx=7)
    rect(16, y + 6, 16, 16, col, rx=4); text(24, y + 18, name[0].upper(), 10, C["bg"], 700, anchor="middle")
    text(40, y + 18.5, name, 12.5, weight=600 if active else 400)
    if badge:
        pill(SB - 44, y + 6, f"● {badge}", C["accent"], 9.5)
    y += 30

y += 22
text(14, y, "Agents", 12, C["muted"])
agents = [("Working 1", [("api", "Rate limiter: add tests", "2m", C["amber"])]),
          ("Done 1", [("web", "Dark mode toggle", "8m", C["accent"])]),
          ("Idle 1", [("docs", "API reference pass", "1h", C["dim"])])]
for head, rows in agents:
    y += 22
    text(14, y, head, 11, C["accent"] if head.startswith("Done") else C["dim"], 600)
    for sp, task, age, col in rows:
        y += 8
        rect(8, y, SB - 16, 26, C["hover"] if head.startswith("Working") else C["chrome"], rx=6)
        out.append(f'<circle cx="22" cy="{y + 13}" r="5" fill="#d97757"/>')
        text(34, y + 17, f"{sp} · {task}", 11.5); text(SB - 28, y + 17, age, 10.5, C["dim"], anchor="end")
        out.append(f'<circle cx="{SB - 18}" cy="{y + 13}" r="3.5" fill="{col}"/>')
        y += 22

text(14, H - 46, "⚙  Settings", 12, C["muted"]); text(14, H - 22, "+  Add machine", 12, C["muted"])

# --- tab bar ---
X0 = SB + 8
TB = 38
rect(SB + 1, 0, W - SB, TB, C["chrome"])
line(SB, TB + 0.5, W, TB + 0.5)
tx = X0
for name, active in [("rate-limiter", True), ("migrations", False), ("review api#412", False)]:
    w = len(name) * 7.4 + 54
    if active:
        rect(tx, 6, w, 28, C["bg"], rx=7, stroke=C["border"])
    out.append(f'<circle cx="{tx + 16}" cy="20" r="5" fill="#d97757"/>')
    text(tx + 28, 24.5, name, 12, C["text"] if active else C["muted"], 500 if active else 400)
    text(tx + w - 14, 24.5, "×", 12, C["dim"], anchor="middle")
    tx += w + 6
text(tx + 8, 24.5, "+", 15, C["dim"])
rx_ = W - 16
for label, on in [("⚙", False), ("PRs", False), ("Changes", True), ("Files", False)]:
    w = len(label) * 7.2 + 18
    rx_ -= w + 4
    if on:
        rect(rx_, 8, w, 24, C["bg"], rx=6, stroke=C["border"])
    text(rx_ + w / 2, 24.5, label, 11.5, C["text"] if on else C["muted"], anchor="middle")

# --- work area: two panes and the side panel ---
ST = 26  # status bar
top, bottom = TB + 8, H - ST - 8
PANEL = 520
px0 = W - 8 - PANEL
paneW = (px0 - 8 - X0 - 8) // 2


def pane(x, w, title, chip, focused, lines):
    rect(x, top, w, bottom - top, C["bg"], rx=10, stroke=C["accent"] if focused else C["border"])
    line(x + 1, top + 30.5, x + w - 1, top + 30.5)
    text(x + 12, top + 20, "›_", 12, C["dim"], font=MONO)
    text(x + 34, top + 20, title, 12, weight=600)
    pill(x + 40 + len(title) * 7, top + 7, chip, C["dim"], 9.5)
    yy = top + 58
    for s, col, wt, bgc in lines:
        if bgc:
            rect(x + 10, yy - 15, w - 20, 21, bgc, rx=3)
        text(x + 16, yy, s, 13, col or C["text"], wt, MONO)
        yy += 21


claude = [
    ("✻ Claude Code", "#d97757", 600, None), ("  ~/code/acme/api · main", C["dim"], 400, None), ("", None, 400, None),
    ("› add rate limiting to the public endpoints, 100/min per key", C["text"], 400, C["raised"]), ("", None, 400, None),
    ("● Reading src/http/router.ts and src/http/middleware/*", C["muted"], 400, None),
    ("● I'll add a token bucket per API key in middleware,", C["text"], 400, None),
    ("  with the limit in config and a Retry-After header.", C["text"], 400, None), ("", None, 400, None),
    ("● Update(src/http/middleware/rateLimit.ts)", C["text"], 600, None),
    ("  + export function rateLimit(opts: Limits) {", C["green"], 400, C["greenbg"]),
    ("  +   const buckets = new Map<string, Bucket>();", C["green"], 400, C["greenbg"]),
    ("  +   return (req, res, next) => {", C["green"], 400, C["greenbg"]),
    ("  -   // TODO: limits", C["red"], 400, C["redbg"]), ("", None, 400, None),
    ("● Bash(npm test -- rateLimit)", C["text"], 600, None),
    ("  ✓ 12 passed (rateLimit.test.ts)", C["green"], 400, None), ("", None, 400, None),
    ("● Done. Limits live in config/limits.ts; 429s carry", C["text"], 400, None),
    ("  Retry-After. Want me to open a PR?", C["text"], 400, None), ("", None, 400, None),
    ("› ", C["text"], 400, None),
]
zsh = [
    ("~/code/acme/api on main", C["accent"], 400, None), ("$ npm run dev", C["text"], 400, None),
    ("  ready on http://localhost:3000", C["green"], 400, None),
    ("  GET  /v1/invoices      200  12ms", C["muted"], 400, None),
    ("  GET  /v1/invoices      200   9ms", C["muted"], 400, None),
    ("  POST /v1/payments      201  31ms", C["muted"], 400, None),
    ("  GET  /v1/invoices      429   1ms", C["amber"], 400, None),
    ("  GET  /v1/customers     200  14ms", C["muted"], 400, None),
]
pane(X0, paneW, "Claude Code", "t3", True, claude)
pane(X0 + paneW + 8, paneW, "zsh", "t4", False, zsh)

# side panel: Changes
rect(px0, top, PANEL, bottom - top, C["bg"], rx=10, stroke=C["border"])
text(px0 + 14, top + 26, "Changes", 13, weight=600)
pill(px0 + 82, top + 13, "4 files", C["muted"], 9.5)
text(px0 + PANEL - 200, top + 26, "+128", 11.5, C["green"]); text(px0 + PANEL - 160, top + 26, "−31", 11.5, C["red"])
rect(px0 + PANEL - 120, top + 12, 106, 22, C["bg"], rx=6, stroke=C["border"]); text(px0 + PANEL - 67, top + 27, "Review branch", 11, anchor="middle")
line(px0 + 1, top + 42.5, px0 + PANEL - 1, top + 42.5)
sx = px0 + 12
for label, on in [("Uncommitted", True), ("Branch", False), ("Commits", False)]:
    w = len(label) * 7 + 20
    rect(sx, top + 52, w, 22, C["hover"] if on else C["bg"], rx=6)
    text(sx + w / 2, top + 67, label, 11.5, C["text"] if on else C["muted"], anchor="middle")
    sx += w + 4
files = [("M", "src/http/middleware/rateLimit.ts", "+64", "−2", True), ("A", "config/limits.ts", "+22", "", False),
         ("M", "src/http/router.ts", "+9", "−4", False), ("A", "test/rateLimit.test.ts", "+33", "−25", False)]
fy = top + 96
for st, path, a, d, sel in files:
    if sel:
        rect(px0 + 6, fy - 16, PANEL - 12, 24, C["hover"], rx=6)
    text(px0 + 16, fy, st, 11, C["amber"] if st == "M" else C["green"], 700, MONO)
    folder, name = path.rsplit("/", 1)
    text(px0 + 34, fy, name, 12); text(px0 + 40 + len(name) * 7, fy, folder, 11, C["dim"])
    text(px0 + PANEL - 64, fy, a, 11, C["green"]); text(px0 + PANEL - 30, fy, d, 11, C["red"])
    fy += 26
line(px0 + 1, fy - 6.5, px0 + PANEL - 1, fy - 6.5)
text(px0 + 14, fy + 14, "rateLimit.ts", 11.5, weight=600); text(px0 + 104, fy + 14, "src/http/middleware", 11, C["dim"])
dy = fy + 30
diff = [("@@ -1,6 +1,40 @@", "@"), ("import type { Limits } from '../../config/limits';", " "), ("", " "),
        ("export function rateLimit(opts: Limits) {", "+"), ("  const buckets = new Map<string, Bucket>();", "+"),
        ("  return (req, res, next) => {", "+"), ("    const key = req.header('x-api-key') ?? req.ip;", "+"),
        ("    const b = buckets.get(key) ?? fresh(opts);", "+"), ("    if (!take(b)) {", "+"),
        ("      res.set('Retry-After', String(b.wait));", "+"), ("      return res.status(429).end();", "+"),
        ("    }", "+"), ("    next();", "+"), ("  };", "+"), ("}", "+"), ("// TODO: limits", "-"), ("", " "),
        ("@@ -48,4 +82,6 @@", "@"), ("function fresh(o: Limits): Bucket {", " "), ("  return { tokens: o.burst, at: Date.now() };", "+"),
        ("  return { tokens: 100 };", "-"), ("}", " ")]
n = 1
for s, kind in diff:
    if dy > bottom - 16:
        break
    if kind == "@":
        rect(px0 + 1, dy - 14, PANEL - 2, 20, C["raised"]); text(px0 + 14, dy, s, 11, C["dim"], font=MONO)
    else:
        if kind in "+-":
            rect(px0 + 1, dy - 14, PANEL - 2, 20, C["greenbg"] if kind == "+" else C["redbg"])
        text(px0 + 36, dy, str(n), 10.5, C["dim"], font=MONO, anchor="end")
        text(px0 + 46, dy, {"+": "+", "-": "−"}.get(kind, ""), 11, C["green"] if kind == "+" else C["red"], font=MONO)
        text(px0 + 58, dy, s, 11, C["text"], font=MONO)
        n += 1
    dy += 20

# --- status bar ---
rect(SB + 1, H - ST, W - SB, ST, C["chrome"])
line(SB, H - ST - 0.5, W, H - ST - 0.5)
text(X0 + 4, H - 8.5, "▭  This computer   ·   3 agents   ·   api: main ↑2", 11, C["muted"])
text(W - 16, H - 8.5, "⌃; service   ⌃w window   ⌘K keys", 11, C["dim"], anchor="end")

# --- the service mode's key strip ---
KW, KH = 860, 150
kx, ky = X0 + (px0 - X0 - KW) / 2, bottom - KH - 22
out.append(f'<rect x="{kx}" y="{ky + 6}" width="{KW}" height="{KH}" rx="10" fill="#000" opacity="0.10"/>')
rect(kx, ky, KW, KH, C["bg"], rx=10, stroke=C["border"])
rect(kx + 14, ky + 12, 62, 20, C["accent"], rx=5); text(kx + 45, ky + 26, "SERVICE", 11, C["bg"], 700, anchor="middle")
text(kx + 86, ky + 26, "sticky: keys repeat until esc · counts: 3j, 2gt", 11.5, C["muted"])
keys = [("%", "Split right"), ('"', "Split down"), ("x", "Close pane"), ("z", "Zoom pane"), ("c", "New tab"),
        ("h j k l", "Go to a pane"), ("H J K L", "Swap panes"), ("n p", "Next / prev tab"), ("Z", "Zen mode"), ("f", "Focus mode"),
        ("- =", "Narrower / wider"), ("_ +", "Shorter / taller"), ("u", "Undo close"), ("[", "Vim mode"), ("?", "Edit key modes")]
cols, cw = 5, (KW - 28) / 5
for i, (k, label) in enumerate(keys):
    cx_, cy_ = kx + 14 + (i % cols) * cw, ky + 46 + (i // cols) * 28
    kwid = max(26, len(k) * 7.5 + 10)
    rect(cx_, cy_, kwid, 19, C["accent"], rx=4, op=0.15)
    text(cx_ + kwid / 2, cy_ + 13.5, k, 11, C["accent"], 600, anchor="middle")
    text(cx_ + kwid + 8, cy_ + 13.5, label, 11.5)

out.append("</g></svg>")
dest = Path(__file__).resolve().parent.parent / "layouts" / "ks.svg"
dest.write_text("\n".join(out) + "\n")
print(f"wrote {dest}")
