// A theme colour with transparency added. Theme colours can already carry their own (#rrggbbaa: Herdr derives
// some, such as `border`, that way), so appending two hex digits isn't safe: alpha() multiplies the two instead.
// Source of truth: shared/color.js; scripts/install.sh copies it into each mod's lib/.
export function alpha(color, aa) {
  let s = String(color ?? "").trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
  if (/^#[0-9a-f]{6}$/i.test(s)) return s + aa;
  if (/^#[0-9a-f]{8}$/i.test(s)) {
    const a = Math.round((parseInt(s.slice(7), 16) * parseInt(aa, 16)) / 255);
    return s.slice(0, 7) + a.toString(16).padStart(2, "0");
  }
  return s;
}
