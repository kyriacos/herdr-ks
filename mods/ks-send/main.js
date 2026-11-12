// The check before review comments go to an agent: every pending comment (of the given worktrees, or of one
// file), grouped by worktree and file, each with a checkbox, Edit, Delete and its own Send; a note for anything
// not tied to a line; which agent gets it; a preview of the exact message. Nothing is sent until Send.
// Opened as a dialog by the review tab ("Send N to agent") and the Changes panel ("Send all to agent"):
// openOverlay({ mod: "ks-send", kind: "dialog", props: { roots?, path?, agent?, space? } }).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar } from "gpui-base";
import { props, theme, settings, closeOverlay } from "herdr";
import * as comments from "./lib/comments.js";

const base = (p) => p.replace(/\/+$/, "").split("/").pop();
const where = (c) => (c.line == null ? "whole file" : `line ${c.line}${c.side === "old" ? " (removed)" : ""}`) + (c.commit ? ` · commit ${c.commit}` : "");

export default class Send extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.roots = p.roots ?? null; this.path = p.path ?? null; this.overlay = p.overlay ?? null;
    this.agent = comments.pickAgent(p.agent ?? null, p.space ?? null)?.address ?? null;
    this.selected = new Set(this.pending().map((c) => c.id)); // all ticked to start
    this.known = new Set(this.selected);                      // comments seen: new ones arrive ticked
    this.editing = null; this.preview = false; this.sending = false;
    this.editInput = InputState.new({ placeholder: "Comment" });
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.note = TextareaState.new({ placeholder: "Anything else for the agent (optional, goes after the comments)", rows: 2 });
    this.handle = cx.focus_handle(); this.handle.focus();
  }

  pending() {
    return comments.all().filter((c) => (!this.roots || this.roots.includes(c.root)) && (!this.path || c.path === this.path));
  }
  chosen() { return this.pending().filter((c) => this.selected.has(c.id)); }
  close() { if (this.overlay) closeOverlay(this.overlay); }

  toggle(id, cx) { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); cx.notify(); }
  setAll(on, cx) { this.selected = new Set(on ? this.pending().map((c) => c.id) : []); cx.notify(); }
  edit(c, cx) { this.editing = c.id; this.editInput.set_value(c.text); this.editInput.focus(); cx.notify(); }
  saveEdit(cx) {
    const text = this.editInput.value().trim();
    if (this.editing && text) comments.update(this.editing, { text });
    this.editing = null; this.handle.focus(); cx.notify();
  }
  remove(c, cx) { comments.remove(c.id); this.selected.delete(c.id); cx.notify(); }

  async sendList(list, withNote, cx) {
    if (this.sending) return;
    const note = withNote ? this.note.value() : "";
    if (!list.length && !note.trim()) return;
    this.sending = true; cx.notify();
    const ok = await comments.send(list, this.agent, null, note);
    this.sending = false;
    if (ok && withNote) this.note.set_value("");
    for (const c of list) this.selected.delete(c.id);
    if (ok && !this.pending().length) { this.close(); return; }
    cx.notify();
  }

  render(cx) {
    const t = theme(), list = this.pending(), chosen = list.filter((c) => this.selected.has(c.id));
    // Comments added while the dialog is open (another review tab) arrive ticked.
    for (const c of list) if (!this.known.has(c.id)) { this.known.add(c.id); this.selected.add(c.id); }
    const agents = comments.agentChoices();
    if (this.agent && !agents.some((a) => a.address === this.agent)) this.agent = agents[0]?.address ?? null;
    const button = (id, label, act, primary = false, enabled = true) => div().id(id).flex_none().h(28).px(12).flex().items_center().rounded(7).text_size(12)
      .bg(primary && enabled ? t.solid : t.background).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(primary && enabled ? t.solid : t.border)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => act(cx))).child(label);
    const link = (id, label, act, tone) => div().id(id).flex_none().px(6).py(1).rounded(4).cursor_pointer().text_size(11).text_color(tone)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(label);

    // worktree -> file -> comments, in a stable order
    const groups = new Map();
    for (const c of [...list].sort((a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0))) {
      const g = groups.get(c.root) ?? groups.set(c.root, new Map()).get(c.root);
      (g.get(c.path) ?? g.set(c.path, []).get(c.path)).push(c);
    }
    const rows = [];
    for (const [root, files] of groups) {
      rows.push(div().flex_none().px(4).pt(10).pb(2).text_size(11.5).font_semibold().text_color(t.muted).child(`${base(root)} · ${root}`));
      for (const [path, cs] of files) {
        rows.push(div().flex_none().px(4).pt(4).text_size(12).text_color(t.foreground).truncate().child(path));
        for (const c of cs) {
          const on = this.selected.has(c.id), editing = this.editing === c.id;
          rows.push(h_flex().id(`row-${c.id}`).flex_none().mt(4).p(8).gap(10).items_start().rounded(8).border_1()
            .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background).cursor_pointer()
            .on_click((_e, cx) => { if (!editing) this.toggle(c.id, cx); })
            .child(div().w(16).flex_none().text_size(13).text_color(on ? t.accent : t.dim).child(on ? "☑" : "☐"))
            .child(v_flex().flex_1().min_w(0).gap(3)
              .child(div().text_size(10.5).font_semibold().text_color(t.accent).child(where(c)))
              .when(Boolean(c.code), (e) => e.child(div().text_size(11).text_color(t.dim).truncate().font_family(settings().font_family ?? "JetBrains Mono").child(c.code.trim())))
              .child(editing
                ? div().h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
                    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.editInput).h_full().text_size(12.5).text_color(t.foreground))
                : div().text_size(12.5).text_color(t.foreground).child(c.text)))
            .child(h_flex().flex_none().gap(2)
              .child(editing ? link(`save-${c.id}`, "Save", (cx) => this.saveEdit(cx), t.accent) : link(`edit-${c.id}`, "Edit", (cx) => this.edit(c, cx), t.muted))
              .child(link(`del-${c.id}`, "Delete", (cx) => this.remove(c, cx), t.dim))
              .child(link(`one-${c.id}`, "Send", (cx) => this.sendList([c], false, cx), t.accent))));
        }
      }
    }
    const message = comments.format(chosen, this.note.value());
    return v_flex().id("send").size_full().p(16).gap(10).bg(t.popover ?? t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { if (this.editing) { this.editing = null; cx.notify(); } else this.close(); cx.stop_propagation(); } })
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().font_semibold().text_size(14).child(`Comments for the agent · ${list.length} pending`))
        .child(link("all", "Select all", (cx) => this.setAll(true, cx), t.accent))
        .child(link("none", "None", (cx) => this.setAll(false, cx), t.muted)))
      .child(h_flex().flex_none().gap(6).items_center().flex_wrap()
        .child(div().flex_none().text_size(11.5).text_color(t.muted).child("Send to"))
        .when(!agents.length, (e) => e.child(div().text_size(11.5).text_color(t.ansi1).child("no agent running")))
        .children(agents.map((a) => div().id(`agent-${a.address}`).flex_none().h(24).px(9).flex().items_center().rounded(12).cursor_pointer().text_size(11)
          .bg(this.agent === a.address ? t.selected : t.background).border_1().border_color(this.agent === a.address ? t.accent : t.border)
          .text_color(this.agent === a.address ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.agent = a.address; cx.notify(); }).child(a.title))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("send-list").absolute().inset_0().overflow_y_scroll().pr(6)
          .when(!list.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child("No comments waiting. Write a note below to send just that.")))
          .children(rows))
        .child(Scrollbar.vertical("send-list").absolute().inset_0()))
      .child(div().flex_none().p(6).rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(Textarea.new(this.note).w_full().text_size(12.5).text_color(t.foreground)))
      .when(this.preview, (e) => e.child(v_flex().id("preview").flex_none().max_h(200).overflow_y_scroll().p(8).rounded(8).bg(t.raised)
        .font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
        .children((message || "(nothing selected)").split("\n").map((l) => div().child(l || " ")))))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(link("preview-toggle", this.preview ? "Hide message" : "Show message", (cx) => { this.preview = !this.preview; cx.notify(); }, t.muted))
        .child(div().flex_1())
        .child(button("cancel", "Close", () => this.close()))
        .child(button("send-selected", this.sending ? "Sending…" : `Send selected (${chosen.length})`, (cx) => this.sendList(chosen, true, cx), true,
          !this.sending && Boolean(this.agent) && (chosen.length > 0 || Boolean(this.note.value().trim())))));
  }
}
