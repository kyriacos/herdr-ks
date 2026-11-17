// Attachments for Tasks and Notes: files dropped from Finder, picked in a file dialog, or an image pasted from the
// clipboard. Each is copied into <app home>/data/ks-attach/ (the app draws pictures only from its own folder, and a
// copy outlives the original being moved or deleted), and kept on its task or note as
// { id, name, rel, kind: "image" | "file", size, w, h }. `rel` is the copy's path from the app home.
// Source of truth: shared/attach.js; scripts/install.sh copies it into each mod's lib/.
import { exec, appHome } from "herdr";
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";

const DIR = "data/ks-attach";
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?|svg)$/i;
const newId = () => `a${Date.now().toString(36)}${Math.round(Math.random() * 1e5).toString(36)}`;
const safe = (name) => String(name).replace(/[^\w.\- ]+/g, "_").slice(-80) || "file";
export const abs = (a) => `${appHome()}/${a.rel}`;

export function size(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// Copies one file in; its size, and for a picture its pixel size (sips), for the thumbnail.
async function copyIn(src, name = null) {
  const id = newId(), base = safe(name ?? src.split("/").pop()), rel = `${DIR}/${id}-${base}`, kind = IMAGE.test(base) ? "image" : "file";
  const script = 'mkdir -p "$(dirname "$2")" && cp -R "$1" "$2" && stat -f %z "$2" && { [ "$3" = image ] && sips -g pixelWidth -g pixelHeight "$2" 2>/dev/null || true; }';
  const r = await exec("sh", ["-c", script, "sh", src, `${appHome()}/${rel}`, kind], { timeout: 20000 }).catch(() => null);
  if (!r || r.code !== 0) return null;
  const bytes = Number(r.stdout.split("\n")[0]) || 0;
  const w = Number(/pixelWidth: (\d+)/.exec(r.stdout)?.[1]) || 0, h = Number(/pixelHeight: (\d+)/.exec(r.stdout)?.[1]) || 0;
  return { id, name: base, rel, kind, size: bytes, w, h, added: Date.now() };
}

// Paths (dropped, or picked) -> attachments. Folders are copied whole, as a file.
export async function addPaths(paths) {
  const out = [];
  for (const p of paths ?? []) { const a = await copyIn(p); if (a) out.push(a); }
  return out;
}

// The macOS file dialog; [] when cancelled.
export async function pickFiles() {
  const script = ['set fs to choose file with prompt "Attach files" with multiple selections allowed', 'set out to ""',
    "repeat with f in fs", "set out to out & POSIX path of f & linefeed", "end repeat", "return out"];
  const r = await exec("osascript", script.flatMap((l) => ["-e", l]), { timeout: 600000 }).catch(() => null);
  if (!r || r.code !== 0) return [];
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}
export async function pickAndAdd() { return addPaths(await pickFiles()); }

// The clipboard's picture as a PNG attachment; null when it holds none.
export async function pasteImage() {
  const tmp = `${appHome()}/${DIR}/.paste-${newId()}.png`;
  const script = [`set p to POSIX file "${tmp}"`, "try", "set d to the clipboard as «class PNGf»", "on error", 'return "none"', "end try",
    "set f to open for access p with write permission", "write d to f", "close access f", 'return "ok"'];
  await exec("mkdir", ["-p", `${appHome()}/${DIR}`]).catch(() => null);
  const r = await exec("osascript", script.flatMap((l) => ["-e", l]), { timeout: 10000 }).catch(() => null);
  if (!r || r.stdout.trim() !== "ok") return null;
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  const a = await copyIn(tmp, `pasted-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`);
  exec("rm", ["-f", tmp]).catch(() => null);
  return a;
}

export const openAtt = (a) => exec("open", [abs(a)]).catch(() => null);
export const revealAtt = (a) => exec("open", ["-R", abs(a)]).catch(() => null);
// Deletes the copies (the originals are untouched).
export function dropFiles(list) {
  const paths = (list ?? []).filter((a) => a?.rel?.startsWith(DIR + "/")).map(abs);
  if (paths.length) exec("rm", ["-rf", ...paths]).catch(() => null);
}

// A row of attachments: pictures as thumbnails, other files as chips. Click opens, the × removes (`onRemove`, when
// given). `big`: larger thumbnails (a task's detail).
export function attachRow(list, t, idp, { onRemove = null, big = false } = {}) {
  const H = big ? 96 : 44;
  return h_flex().flex_wrap().gap(6).items_end().children((list ?? []).map((a) => {
    const x = onRemove && div().id(`${idp}-x-${a.id}`).absolute().top(2).right(2).size(16).flex().items_center().justify_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border).text_size(10).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); onRemove(a, cx); }).child("×");
    if (a.kind === "image") {
      const w = a.w && a.h ? Math.min(H * 2.4, Math.max(H * 0.6, (H * a.w) / a.h)) : H * 1.4;
      return div().id(`${idp}-${a.id}`).relative().flex_none().rounded(6).overflow_hidden().border_1().border_color(t.border).cursor_pointer()
        .tooltip(`${a.name} · ${size(a.size)} · click to open`).on_click((_e, cx) => { cx.stop_propagation(); openAtt(a); })
        .child(image(a.rel).w(w).h(H)).when(Boolean(x), (e) => e.child(x));
    }
    return h_flex().id(`${idp}-${a.id}`).relative().flex_none().h(big ? 30 : 24).pl(8).pr(onRemove ? 22 : 8).gap(6).items_center().rounded(6)
      .border_1().border_color(t.border).bg(t.chrome).text_size(11).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${a.name} · click to open`).on_click((_e, cx) => { cx.stop_propagation(); openAtt(a); })
      .child(div().max_w(big ? 260 : 150).truncate().text_color(t.foreground).child(a.name))
      .child(div().text_color(t.dim).child(size(a.size))).when(Boolean(x), (e) => e.child(x.top(4)));
  }));
}
