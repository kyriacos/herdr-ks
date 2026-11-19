// A segmented control's option (Today / Board, Here / All, the dashboard's ranges...): the chosen one in the accent
// colour (tinted, bold), so it reads in light and dark themes alike; the others quiet until hovered.
// Source of truth: shared/segment.js; scripts/install.sh copies it into each mod's lib/.
import { div } from "gpui-kit";

export const segment = (t, id, label, on, act, { h = 22, px = 8, size = 11 } = {}) =>
  div().id(id).h(h).px(px).flex().items_center().rounded(5).cursor_pointer().text_size(size)
    .when(on, (e) => e.bg(t.accent + "26").text_color(t.accent).font_semibold())
    .when(!on, (e) => e.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_click((_e, cx) => act(cx)).child(label);
