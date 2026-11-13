// ks-zen: zen mode, focus mode, and their settings.
//
// Zen (cmd-shift-z, service Z, vim zz): the terminal you're in, alone in a floating window over everything, on a
// glass backdrop that covers the rest of the window. Both are windows over the layout you're in, so they wear the
// theme that's showing; nothing switches. The zen window has a title bar to drag it by, corner grips to resize it
// (ks-resize, as the review windows), Narrower / Wider, ⚙ settings and Exit. Clicking the backdrop brings the zen
// window back to the front.
// Focus mode (cmd-shift-f, service f): the interface around the terminals dims until hovered (lib/focus.js).
// Settings (main menu, service F, the bar's ⚙): focus on/off and how much it dims (live), zen's backdrop.
//
// Copies, by props: none (floating in the layout, draws nothing, takes the commands), { backdrop }, { bar } (the
// zen window's title bar, with the top corner grips), { foot } (its bottom edge, with the bottom grips), and
// { settings } (the dialog).
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, spaces, panes, focused, nextCommand, shared, setShared, notify, theme, props, openOverlay, closeOverlay, exec, appHome, settings, layout } from "herdr";
import { focusOn, focusLevel, setFocus } from "./lib/focus.js";

// Shared "ks-zen.state" while zen is open: { terminal, win (overlay id), backdrop (overlay id), rect: the zen
// window in window points { x, y, width, height } }.
const ZEN = "ks-zen.state";
// { backdrop: "theme" | "dark" (its color), opacity: 0.4..1 (1 opaque; below, the layout shows through like glass),
//   share: the zen window's size as a share of the app window }
const PREFS = "ks-zen.prefs";
const prefs = () => ({ backdrop: "theme", opacity: 1, share: 0.78, ...(shared(PREFS) ?? {}) });
const hex2 = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
const zen = () => shared(ZEN);
export const zenOpen = () => Boolean(zen()?.win);

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

async function windowSize() {
  const r = await exec("cat", [`${appHome()}/window.json`]).catch(() => null);
  try { const b = JSON.parse(r.stdout).bounds; return { w: b[2], h: b[3] }; } catch { return { w: 1600, h: 1000 }; }
}

// The terminal to show: the focused pane's, else the shown tab's first.
function currentTerminal() {
  const ps = panes(), f = ps.find((p) => p.focused) ?? ps.find((p) => p.pane === focused()?.pane);
  if (f?.terminal) return f.terminal;
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.active);
  return ps.find((p) => p.tab === tab?.id && p.terminal)?.terminal ?? null;
}

// The zen window's openOverlay spec: a title bar, the terminal, a bottom edge with grips. `rect` in window points;
// width/height go to Herdr in mod pixels (points / zoom).
// Not moved (`moved` false): no `at`, so Herdr centers it exactly; after a drag, at its place.
function zenSpec(terminal, rect, moved = false) {
  const z = settings().zoom || 1;
  return {
    mod: "ks-zen", kind: "window", key: "ks-zen", width: Math.round(rect.width / z), height: Math.round(rect.height / z),
    ...(moved ? { at: { x: Math.round(rect.x), y: Math.round(rect.y) } } : {}), props: { bar: true },
    layout: { type: "column", children: [
      { type: "block", size: { px: 36 }, content: { mod: "ks-zen", props: { bar: true } } },
      { type: "block", content: { terminal } },
      { type: "block", size: { px: 12 }, content: { mod: "ks-zen", props: { foot: true } } },
    ] },
  };
}

// Opens (or reopens, to move or resize) the zen window. A window opened last is on top, so when the key modes strip
// is open (resizing zen from service mode) it is asked to come back on top, and it keeps the keyboard.
function showZen(terminal, rect, moved = zen()?.moved ?? false) {
  const win = openOverlay(zenSpec(terminal, rect, moved));
  setShared(ZEN, { ...(zen() ?? {}), terminal, rect, win, moved });
  // No pane.focus: focusing the terminal would switch back to its tab (Herdr prefers the pane). The window opened
  // last has the keyboard.
  if (shared("ks-keys.open")) run("ks-keys.raise");
}

async function openZen() {
  const terminal = currentTerminal();
  if (!terminal) return notify({ title: "Zen needs a terminal", body: "Focus a terminal pane first.", level: "info", timeout: 2500 });
  const { w, h } = await windowSize(), share = prefs().share;
  const rect = { width: Math.round(w * share), height: Math.round(h * Math.min(0.92, share + 0.1)) };
  rect.x = Math.round((w - rect.width) / 2); rect.y = Math.round((h - rect.height) / 2);
  const backdrop = openOverlay({ mod: "ks-zen", kind: "window", key: "ks-zen-backdrop", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { backdrop: true } });
  // The tab behind must not be drawn while zen shows its terminal: drawn twice at two sizes, the terminal is resized
  // back and forth (Claude's screen breaks) and focusing it lands in the tab, not zen. So the space shows a blank
  // placeholder tab meanwhile; closing zen removes it and shows the tab again.
  const tab = panes().find((p) => p.terminal === terminal)?.tab ?? null;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === tab))?.id ?? null;
  setShared(ZEN, { terminal, rect, backdrop, win: null, tab, placeholder: null });
  if (tab && space) {
    const before = new Set(spaces().find((s) => s.id === space)?.tabs.map((t) => t.id) ?? []);
    run("tab.new", { space, name: "zen", mod: "ks-zen", props: { placeholder: true } });
    // Herdr's live data catches up in a moment: the new tab is the one that wasn't there.
    for (let i = 0; i < 10; i++) {
      await exec("sleep", ["0.05"]).catch(() => null);
      const fresh = spaces().find((s) => s.id === space)?.tabs.find((t) => !before.has(t.id));
      if (fresh) { setShared(ZEN, { ...zen(), placeholder: fresh.id }); break; }
    }
  }
  showZen(terminal, rect);
}

// A window reopened by ks-resize has a new overlay id; opening its key again replaces it and returns the id
// that closes it for sure.
const closeKey = (key) => closeOverlay(openOverlay({ mod: "ks-zen", kind: "window", key, frame: "none", width: 1, height: 1, props: { closing: true } }));

function closeZen() {
  const st = zen();
  if (!st) return;
  closeKey("ks-zen");
  closeKey("ks-zen-backdrop");
  setShared(ZEN, null);
  // The tab comes back, shown, with the terminal focused in it; the placeholder goes.
  if (st.tab) run("tab.select", { id: st.tab });
  if (st.placeholder) run("tab.close", { id: st.placeholder, confirmed: true });
  if (st.terminal) run("pane.focus", { terminal: st.terminal });
}

const toggleZen = () => (zenOpen() ? closeZen() : openZen());

// Narrower / wider (dw) and shorter / taller (dh), as shares of the app window: the zen window changes around its
// middle, and its width share is remembered.
async function resizeZen(dw, dh) {
  const st = zen();
  if (!st?.win) return;
  const { w, h } = await windowSize(), r = st.rect;
  const width = Math.max(420, Math.min(w, r.width + Math.round(w * dw) * 2)), height = Math.max(300, Math.min(h, r.height + Math.round(h * dh) * 2));
  // A centered window stays centered (Herdr centers it); a moved one grows around its middle.
  const rect = st.moved
    ? { width, height, x: Math.max(0, Math.round(r.x + (r.width - width) / 2)), y: Math.max(0, Math.round(r.y + (r.height - height) / 2)) }
    : { width, height, x: Math.round((w - width) / 2), y: Math.round((h - height) / 2) };
  if (dw) setShared(PREFS, { ...prefs(), share: Math.round((width / w) * 100) / 100 });
  showZen(st.terminal, rect);
}
const widen = (step) => resizeZen(step, 0);

// Back to the default size (78% wide), centered in the window.
async function resetZen() {
  const st = zen();
  if (!st?.win) return;
  const { w, h } = await windowSize(), share = 0.78;
  const rect = { width: Math.round(w * share), height: Math.round(h * Math.min(0.92, share + 0.1)) };
  rect.x = Math.round((w - rect.width) / 2); rect.y = Math.round((h - rect.height) / 2);
  setShared(PREFS, { ...prefs(), share });
  showZen(st.terminal, rect, false);
}

function toggleFocus() {
  const on = !focusOn();
  setFocus({ on });
  notify({ title: on ? "Focus mode on" : "Focus mode off", body: on ? `Dims to ${Math.round(focusLevel() * 100)}% until you point at it. ⌘⇧F turns it off.` : "", level: "info", timeout: 2500 });
}

const openSettings = () => openOverlay({ mod: "ks-zen", kind: "dialog", width: 480, height: 460, props: { settings: true } });

export default class Zen extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.settings) { this.handle = cx.focus_handle(); this.handle.focus(); return; }
    if (p.closing || p.placeholder) return;
    if (p.backdrop || p.bar || p.foot) {
      // A window reopened by ks-resize carries its new rect.
      // A corner drag placed it: from now on it keeps its place.
      if (p.rect && zen() && JSON.stringify(p.rect) !== JSON.stringify(zen().rect)) setShared(ZEN, { ...zen(), rect: p.rect, moved: true });
      return;
    }
    // The layout copy starts with the layout, and a layout switch closes windows: zen isn't open any more.
    if (zen()) setShared(ZEN, null);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") await toggleZen();
        else if (c === "focus") toggleFocus();
        else if (c === "wider") await widen(0.02);
        else if (c === "narrower") await widen(-0.02);
        else if (c === "grow") await resizeZen(0.02, 0.02);
        else if (c === "shrink") await resizeZen(-0.02, -0.02);
        else if (c === "reset") await resetZen();
        else if (c === "taller") await resizeZen(0, 0.02);
        else if (c === "shorter") await resizeZen(0, -0.02);
        else if (c === "settings") openSettings();
        else if (c.startsWith("focus-level:")) setFocus({ level: Math.max(0.1, Math.min(0.9, Number(c.slice(12)) || 0.35)) });
        cx.notify();
      }
    });
  }

  // The zen window's corners: ks-resize follows the drag over the whole app, then reopens the window at that size.
  startResize(corner) {
    const st = zen();
    if (!st?.win) return;
    openOverlay({ mod: "ks-resize", kind: "window", frame: "none", key: "ks-resize", width: 1, height: 1, at: { x: 0, y: 0 },
      props: { rect: st.rect, corner, zoom: settings().zoom || 1, reopen: zenSpec(st.terminal, st.rect, true) } });
  }
  grips(t, corners) {
    return corners.map((corner) => div().id(`zgrip-${corner}`).absolute().size(14)
      .when(corner.includes("t"), (e) => e.top(0)).when(corner.includes("b"), (e) => e.bottom(0))
      .when(corner.includes("l"), (e) => e.left(0)).when(corner.includes("r"), (e) => e.right(0))
      .when(corner === "tl" || corner === "br", (e) => e.cursor_nwse_resize()).when(corner === "tr" || corner === "bl", (e) => e.cursor_nesw_resize())
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.startResize(corner); })
      .when(corner === "br", (e) => e.child(div().absolute().right(3).bottom(2).size(7).border_r_2().border_b_2().border_color(t.dim))));
  }

  render() {
    const p = props() ?? {}, t = theme();
    if (p.settings) return this.renderSettings();
    if (p.placeholder) return div().size_full().bg(t.background); // zen's stand-in tab (see openZen)
    if (p.backdrop) {
      const pr = prefs(), base = pr.backdrop === "dark" ? "#000000" : String(t.background).slice(0, 7);
      // Over everything: the theme's own background (or black), opaque, or see-through like glass at lower opacity.
      // A click brings the zen window back in front.
      // Translucent: the tab area (where the zen terminal also shows) stays solid, so it doesn't show twice; only the
      // rest (sidebar, tab bar, panels) shows through. Its place, in mod px, from the layout's sizes.
      const root = layout(), node = (id) => find(root, id), px = (n) => (n && !n.hidden ? n.size?.px ?? 0 : 0);
      const pad = node("work-body")?.padding ?? 8, sidebar = px(node("sidebar")), panel = px(node("panel"));
      const area = { left: sidebar ? sidebar + 1 : 0, top: px(node("tabs")), right: panel ? panel + pad : 0, bottom: px(node("status")) };
      return div().id("zen-backdrop").size_full().relative().bg(base + hex2(pr.opacity))
        .when(pr.opacity < 1, (e) => e.child(div().absolute().left(area.left).top(area.top).right(area.right).bottom(area.bottom).bg(base)))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); const st = zen(); if (st?.win) showZen(st.terminal, st.rect); });
    }
    if (p.foot) return div().id("zen-foot").size_full().relative().bg(t.background).children(this.grips(t, ["bl", "br"]));
    if (!p.bar) return div();
    const sp = spaces().find((s) => s.active), tab = sp?.tabs.find((x) => x.active);
    const st = zen();
    const stop = (_e, cx) => cx.stop_propagation();
    const btn = (id, label, act) => h_flex().id(id).h(24).px(9).items_center().rounded(6).text_size(11.5).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => { act(); cx.notify(); }).child(label);
    // Unhandled presses on the bar drag the window; after a move, the bar's new place updates the rect.
    return h_flex().id("zen-bar").size_full().relative().px(10).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      // A drag moves the window: how far the bar moved (not where it is, whose coordinates may differ from the
      // window's) is added to the rect, and the window keeps its place from then on.
      .on_mouse_move((ev) => {
        const b = ev.bounds, r = st?.rect;
        if (!b || !r) return;
        if (!this.barAt) { this.barAt = { x: b.x, y: b.y }; return; }
        const dx = b.x - this.barAt.x, dy = b.y - this.barAt.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this.barAt = { x: b.x, y: b.y };
          setShared(ZEN, { ...st, rect: { ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) }, moved: true });
        }
      })
      .child(div().px(7).h(20).flex().items_center().rounded(5).bg(t.accent).text_color(t.solid_foreground ?? t.background).text_size(10.5).font_semibold().child("ZEN"))
      .child(div().pl(6).min_w(0).truncate().text_size(12).text_color(t.foreground).child(tab?.name && !/^tb\d+$/.test(tab.name) ? tab.name : "tab"))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(sp ? `· ${sp.name}` : ""))
      .child(div().flex_1())
      .child(btn("zen-narrow", "Narrower", () => widen(-0.03)))
      .child(btn("zen-wide", "Wider", () => widen(0.03)))
      .child(btn("zen-settings", "⚙", openSettings))
      .child(btn("zen-exit", "Exit  ⌘⇧Z", closeZen))
      .children(this.grips(t, ["tl", "tr"]));
  }

  renderSettings() {
    const t = theme(), p = prefs(), level = focusLevel(), on = focusOn();
    const btn = (id, label, act, active = false) => h_flex().id(id).h(28).px(11).items_center().justify_center().rounded(7).border_1()
      .border_color(active ? t.accent : t.input).bg(active ? t.accent + "22" : t.raised).text_color(active ? t.accent : t.foreground)
      .text_size(12).cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { act(); cx.notify(); }).child(label);
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const pct = Math.round(level * 100);
    const bar = h_flex().h(8).w(220).rounded(4).bg(t.hover).child(div().h_full().w(220 * level).rounded(4).bg(t.accent));
    return v_flex().id("zen-settings").track_focus(this.handle).size_full().p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.keystroke === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Focus & zen")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Focus mode: the interface dims until you point at it (⌘⇧F)"))
      .child(h_flex().gap(8).child(btn("f-on", "On", () => setFocus({ on: true }), on)).child(btn("f-off", "Off", () => setFocus({ on: false }), !on)))
      .child(label(`How visible dimmed parts stay: ${pct}%`))
      .child(h_flex().gap(8).items_center()
        .child(btn("f-less", "−", () => setFocus({ level: Math.max(0.1, Math.round((level - 0.05) * 100) / 100) })))
        .child(bar)
        .child(btn("f-more", "+", () => setFocus({ level: Math.min(0.9, Math.round((level + 0.05) * 100) / 100) }))))
      .child(h_flex().pt(8).gap(6)
        .children([0.2, 0.35, 0.5, 0.7].map((v) => btn(`f-${v}`, `${Math.round(v * 100)}%`, () => setFocus({ level: v, on: true }), Math.abs(level - v) < 0.001))))
      .child(label(`Zen backdrop (⌘⇧Z): ${p.opacity >= 1 ? "opaque" : `translucent, ${Math.round(p.opacity * 100)}%`}`))
      .child(h_flex().gap(8)
        .child(btn("z-opaque", "Opaque", () => setShared(PREFS, { ...p, opacity: 1 }), p.opacity >= 1))
        .child(btn("z-glass", "Translucent", () => setShared(PREFS, { ...p, opacity: 0.7 }), p.opacity < 1))
        .child(btn("z-less", "−", () => setShared(PREFS, { ...p, opacity: Math.max(0.4, Math.round((p.opacity - 0.05) * 100) / 100) })))
        .child(btn("z-more", "+", () => setShared(PREFS, { ...p, opacity: Math.min(1, Math.round((p.opacity + 0.05) * 100) / 100) }))))
      .child(h_flex().pt(8).gap(8)
        .child(btn("z-theme", "Theme color", () => setShared(PREFS, { ...p, backdrop: "theme" }), p.backdrop !== "dark"))
        .child(btn("z-dark", "Dark", () => setShared(PREFS, { ...p, backdrop: "dark" }), p.backdrop === "dark")))
      .child(div().pt(6).text_size(11).text_color(t.dim).child("Zen's size: drag its corners, Narrower / Wider in its bar, or service r then - / +."));
  }
}
