// Resizing a floating review window from a corner. Herdr can't resize a window and only tells a mod about the
// pointer while it is over the mod, so a corner grip can't follow a drag outward. Instead the grip opens this:
// a transparent surface over the whole app (a window at 0,0, full size, no frame) that follows the pointer,
// draws the new outline, and on release reopens the review window at that size and place under the same key,
// then closes itself. The opposite corner stays put.
//
// props: { rect: { x, y, width, height } (the window now, window points), corner: "tl" | "tr" | "bl" | "br",
//          zoom (Herdr's), reopen: an openOverlay spec for the review window (its key, mod, props) }
// Window points: what events report and what `at` takes. openOverlay's width/height are mod pixels (× zoom).
import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay, theme } from "herdr";

const MIN_W = 360, MIN_H = 240; // window points

export default class Resize extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.rect = p.rect ?? { x: 0, y: 0, width: 400, height: 300 }; this.corner = p.corner ?? "br"; this.zoom = p.zoom || 1; this.reopen = p.reopen;
    const r = this.rect;
    // The fixed corner: the one opposite the grip.
    this.anchor = { x: this.corner.includes("l") ? r.x + r.width : r.x, y: this.corner.includes("t") ? r.y + r.height : r.y };
    this.pt = { x: this.corner.includes("l") ? r.x : r.x + r.width, y: this.corner.includes("t") ? r.y : r.y + r.height };
    this.done = false;
    this.handle = cx.focus_handle(); this.handle.focus();
  }

  box() {
    const a = this.anchor, p = this.pt;
    let w = Math.max(MIN_W, Math.abs(p.x - a.x)), h = Math.max(MIN_H, Math.abs(p.y - a.y));
    const x = this.corner.includes("l") ? a.x - w : a.x, y = this.corner.includes("t") ? a.y - h : a.y;
    return { x: Math.max(0, x), y: Math.max(0, y), w, h };
  }

  finish(apply) {
    if (this.done) return;
    this.done = true;
    if (apply && this.reopen) {
      const b = this.box();
      // The new rect (window points) goes to the window and to the mod blocks of a window holding a layout, so
      // they know their size (ks-zen keeps it for its next move or resize).
      const rect = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) };
      const withRect = (n) => n?.content?.mod ? { ...n, content: { ...n.content, props: { ...(n.content.props ?? {}), rect } } }
        : n?.children ? { ...n, children: n.children.map(withRect) } : n;
      openOverlay({ ...this.reopen, kind: "window", width: Math.round(b.w / this.zoom), height: Math.round(b.h / this.zoom), at: { x: rect.x, y: rect.y },
        props: { ...(this.reopen.props ?? {}), rect }, ...(this.reopen.layout ? { layout: withRect(this.reopen.layout) } : {}) });
    }
    closeOverlay(props()?.overlay);
  }

  render(cx) {
    const t = theme(), b = this.box(), z = this.zoom;
    return div().id("resize-surface").size_full().relative().track_focus(this.handle)
      .when(this.corner === "tl" || this.corner === "br", (e) => e.cursor_nwse_resize()).when(this.corner === "tr" || this.corner === "bl", (e) => e.cursor_nesw_resize())
      .on_mouse_move((e, cx) => { this.pt = { x: e.position.x, y: e.position.y }; cx.notify(); })
      .on_mouse_up("left", () => this.finish(true))
      // If the release was missed (it happened outside the app), the next press ends it there.
      .on_mouse_down("left", (e) => { this.pt = { x: e.position.x, y: e.position.y }; this.finish(true); })
      .on_key_down((e) => { if (e.key === "escape") this.finish(false); else if (e.key === "enter") this.finish(true); })
      // The outline, in mod pixels (window points / zoom).
      .child(div().absolute().left(b.x / z).top(b.y / z).w(b.w / z).h(b.h / z).rounded(10).border_2().border_color(t.accent).bg(t.accent + "14"))
      .child(div().absolute().left((b.x + b.w) / z - 120).top((b.y + b.h) / z + 6).w(120).text_right().text_size(11).text_color(t.accent)
        .child(`${Math.round(b.w / z)} × ${Math.round(b.h / z)}`));
  }
}
