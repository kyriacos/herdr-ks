// The sidebar's sections (Dashboard, Tasks, My PRs, Spaces, Agents) share one look, so each reads as its own block:
// a hairline on top (sectionFrame), and the same header (sectionHead): a fold arrow when it folds, the title in small
// capitals, a count, badges (badge), then its buttons on the right (headAction).
// Source of truth: shared/section.js; scripts/install.sh copies it into each mod's lib/.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

export const SECTION_HEAD = 32;

// o: { id, title, count?, collapsed?, onToggle?(cx), onClick?(cx), tip?, badges?: [element], actions?: [element] }
export function sectionHead(t, o) {
  return h_flex().id(`${o.id}-head`).h(SECTION_HEAD).flex_none().pl(8).pr(8).gap(6).items_center()
    .when(Boolean(o.onClick), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => o.onClick(cx)))
    .when(Boolean(o.tip), (e) => e.tooltip(o.tip))
    .child(div().id(`${o.id}-fold`).w(14).flex_none().flex().justify_center().text_size(9).text_color(t.dim)
      .when(Boolean(o.onToggle), (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); o.onToggle(cx); }))
      .child(o.onToggle ? (o.collapsed ? "▶" : "▼") : ""))
    .child(div().flex_none().text_size(10.5).font_semibold().text_color(t.muted).child(String(o.title).toUpperCase()))
    .when(o.count != null && o.count !== "", (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(String(o.count))))
    .children(o.badges ?? [])
    .child(div().flex_1())
    .children(o.actions ?? []);
}

// A count or a state in a header: a soft pill in its colour (`strong` for what needs you).
export const badge = (t, label, tone, strong = false) => div().flex_none().h(16).px(6).flex().items_center().rounded(8)
  .bg(tone + (strong ? "38" : "1c")).text_size(9.5).font_medium().text_color(tone).whitespace_nowrap().child(label);

// A header button: a quiet glyph (or an svg element) that lights up on hover.
export const headAction = (t, id, label, tip, act) => div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(5)
  .cursor_pointer().text_size(11).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
  .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); act(cx); }).child(label);

// A section's root: the hairline that separates it from the one above.
export const sectionFrame = (t, el) => el.border_t(1).border_color(t.border);
