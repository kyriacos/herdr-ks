// Linear issue links: an id (ENG-123) opens at https://linear.app/<workspace>/issue/ENG-123. The workspace is the
// setting (Settings > Pull requests > Linear workspace), else the one learned from the last Linear link seen (in a
// task, a PR description, `ks-task link`). Without either, an id can only be copied.
// Source of truth: shared/linear.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, exec, notify } from "herdr";
import { pref } from "./prefs.js";

const LEARNED = "ks.linearWorkspace";
// Issue titles, learned from what Linear's GitHub bot writes in PR descriptions (a link reading "ENG-123 Title"),
// markdown links ("[ENG-123 Title](…)"), else a link's slug (…/issue/ENG-123/fix-search-filters). Shared state
// "ks.linearTitles": { id: { title, slug } } (slug: only guessed from a link), the last 400 kept.
const TITLES = "ks.linearTitles", ID = "([A-Z][A-Z0-9]{1,9}-\\d{1,6})";
const LINK = new RegExp(`<a href="https://linear\\.app/[\\w-]+/issue/${ID}[^"]*">\\s*\\1[:\\s]+([^<]+?)\\s*</a>`, "g");
const MD = new RegExp(`\\[\\s*${ID}[:\\s]+([^\\]]+?)\\s*\\]\\(https://linear\\.app/`, "g");
const SLUG = new RegExp(`https://linear\\.app/[\\w-]+/issue/${ID}/([a-z0-9-]+)`, "g");
const humanize = (slug) => { const w = slug.replace(/-/g, " ").trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
const unescape = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// Remembers the workspace of the first Linear issue link in `text`, and the titles of the issues it names.
export function learnLinear(text) {
  const s = String(text ?? "");
  if (!s.includes("linear.app/")) return;
  const m = s.match(/https:\/\/linear\.app\/([\w-]+)\/issue\//);
  if (m && shared(LEARNED) !== m[1]) setShared(LEARNED, m[1]);
  const had = shared(TITLES) ?? {}, found = {};
  for (const re of [LINK, MD]) for (const [, id, t] of s.matchAll(re)) found[id] = { title: unescape(t).trim() };
  for (const [, id, slug] of s.matchAll(SLUG)) if (!found[id] && !had[id]) found[id] = { title: humanize(slug), slug: true };
  const fresh = Object.entries(found).filter(([id, v]) => had[id]?.title !== v.title && !(v.slug && had[id] && !had[id].slug));
  if (!fresh.length) return;
  const next = { ...had };
  for (const [id, v] of fresh) { delete next[id]; next[id] = v; }
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete next[k];
  setShared(TITLES, next);
}
// An issue's title, "" when none was seen.
export const linearTitle = (id) => shared(TITLES)?.[id]?.title ?? "";
export const linearWorkspace = () => String(pref("linearWorkspace") || shared(LEARNED) || "").trim();
// The issue's link: the one given, else built from the workspace; null when neither is known.
export function linearUrl(id, known = null) {
  if (known) return known;
  const w = linearWorkspace();
  return w ? `https://linear.app/${w}/issue/${id}` : null;
}
// A click on an id: opens it in Linear (the app takes the link when it's installed), else copies the id.
export function openLinear(id, known, cx) {
  const url = linearUrl(id, known);
  if (url) { exec("open", [url]).catch(() => null); return; }
  cx.write_to_clipboard(id);
  notify({ title: `Copied ${id}`, body: "Set your Linear workspace in Settings > Pull requests to open issues directly", level: "info", timeout: 3000 });
}
export const copyLinear = (id, cx) => { cx.write_to_clipboard(id); notify({ title: `Copied ${id}`, level: "info", timeout: 1500 }); };
