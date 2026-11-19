// Linear issue links: an id (ENG-123) opens at https://linear.app/<workspace>/issue/ENG-123. The workspace is the
// setting (Settings > Pull requests > Linear workspace), else the one learned from the last Linear link seen (in a
// task, a PR description, `ks-task link`). Without either, an id can only be copied.
// Source of truth: shared/linear.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, exec, notify } from "herdr";
import { pref } from "./prefs.js";

const LEARNED = "ks.linearWorkspace";
// Remembers the workspace of the first Linear issue link in `text`, if any.
export function learnLinear(text) {
  const m = String(text ?? "").match(/https:\/\/linear\.app\/([\w-]+)\/issue\//);
  if (m && shared(LEARNED) !== m[1]) setShared(LEARNED, m[1]);
}
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
