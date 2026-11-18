// Asks before something destructive, e.g. "Close tab?". Opened as a
// dialog with props { title, detail, command: { name, args } }.
// Cloned from Herdr's `confirm`: Cancel is chosen when it opens, so Enter
// cancels; Tab and Shift-Tab (or ←/→, h/l) move between Cancel and Confirm, Enter or Space
// presses the chosen one, Esc cancels.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, shared, setShared } from "herdr";
import * as closing from "./lib/closing.js";

export default class Confirm extends View {
  init(_props, cx) {
    this.no = cx.focus_handle();
    this.yes = cx.focus_handle();
    this.at = "no";
    this.overlay = props()?.overlay;
    this.no.focus();
    // Opened from a key strip (ctrl-w c, service c), the strip hands the keyboard back to the pane as it closes,
    // after this dialog took it: take it again a few times while it settles (Tab, Enter and Esc need it here).
    for (const ms of [0, 120, 300, 600, 1000]) cx.timer.after(ms, () => { if (!this.no.is_focused() && !this.yes.is_focused()) this[this.at].focus(); });
  }

  // ks-tabs and ks-pane keep the open dialog under this key, so only one is up at a time.
  // A newer dialog may already have replaced the id: leave that one alone.
  async close() {
    if (shared("ks-confirm.open") === this.overlay) setShared("ks-confirm.open", null);
  }

  // The window doesn't move the keyboard between a dialog's tab stops on Tab: the dialog hears the key
  // and moves it itself. With two buttons, Tab and Shift-Tab both go to the other one.
  move(cx) {
    this.at = this.at === "no" ? "yes" : "no";
    this[this.at].focus();
    cx.notify();
  }

  press() {
    const p = props();
    closeOverlay(p.overlay);
    if (this.at !== "yes") return;
    // ks: tabs and spaces close with 30 s to undo (lib/closing.js).
    if (p.soft?.kind === "space") closing.closeSpace(p.soft.id);
    else if (p.soft?.kind === "tab") closing.closeTab(p.soft.id);
    else run(p.command.name, p.command.args ?? {});
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const button = (id, label, bg, fg, border) =>
      h_flex().id(id).track_focus(this[id]).tab_index(0).h(32).px(14).items_center().rounded(8).border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(() => { this.at = id; this.press(); })
        .child(label)
        .when(this.at === id, (el) => el.relative().child(div().absolute().inset(-3).rounded(10).border(2).border_color(t.accent)));
    return v_flex()
      .id("confirm")
      .on_key_down((e, cx) => {
        if (e.key === "tab") this.move(cx);
        else if (e.key === "enter" || e.key === "space") this.press();
        else if (e.key === "left" || e.key === "right" || e.key === "h" || e.key === "l") { this.at = e.key === "left" || e.key === "h" ? "no" : "yes"; this[this.at].focus(); cx.notify(); }
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(p.detail ?? ""))
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .text_size(12)
          .child(button("no", "Cancel", t.raised, t.foreground, t.input))
          .child(button("yes", "Confirm", t.solid, t.solid_foreground, t.solid)),
      );
  }
}
