// A small file cache for stale-while-revalidate: show the last answer at once, refresh it in the background.
// Files in <app home>/data/ks-cache/, one JSON per key, so every mod (and every window copy of one) shares them
// without Herdr's shared state (a write there redraws every mod). Source of truth: shared/cache.js; scripts/
// install.sh copies it into each mod's lib/.
import { exec, appHome } from "herdr";

const dir = () => `${appHome()}/data/ks-cache`;
const file = (key) => `${dir()}/${String(key).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180)}.json`;

// { at (ms), value } or null.
export async function get(key) {
  const r = await exec("cat", [file(key)]).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

export async function set(key, value) {
  const body = JSON.stringify({ at: Date.now(), value });
  await exec("sh", ["-c", 'mkdir -p "$1" && printf "%s" "$3" > "$2.tmp" && mv "$2.tmp" "$2"', "sh", dir(), file(key), body]).catch(() => null);
}

// How old an entry is, in ms (Infinity when there is none).
export const age = (entry) => (entry?.at ? Date.now() - entry.at : Infinity);

// Housekeeping. Entries in use are rewritten as they refresh (an open PR's every few minutes), so a file's mtime
// says when it was last useful.
// prune(days): deletes entries not written for that many days (0: keeps everything).
export async function prune(days) {
  if (!(days > 0)) return;
  await exec("find", [dir(), "-name", "*.json", "-mtime", `+${Math.round(days)}`, "-delete"]).catch(() => null);
}

// Entries no longer in use: PRs merged or closed, PRs not in My PRs and not opened in a day, and panel lists for
// worktree sets not seen in a day. My PRs' own list is always kept. Resolves to the file paths.
export async function inactive() {
  const r = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && for f in *.json; do [ -e "$f" ] && echo "$(stat -f %m "$f") $f"; done', "sh", dir()]).catch(() => null);
  const files = (r?.stdout ?? "").split("\n").filter(Boolean).map((l) => { const i = l.indexOf(" "); return { at: Number(l.slice(0, i)) * 1000, name: l.slice(i + 1) }; });
  const mine = new Set(((await get("myprs"))?.value ?? []).map((p) => p.url));
  const day = Date.now() - 86400000, out = [];
  for (const f of files) {
    if (f.name === "myprs.json") continue;
    if (f.name.startsWith("pr_")) {
      const e = await get(f.name.replace(/\.json$/, "")), pr = e?.value?.pr;
      if (!pr || pr.state && pr.state !== "OPEN" || (!mine.has(pr.url) && f.at < day)) out.push(`${dir()}/${f.name}`);
    } else if (f.at < day) out.push(`${dir()}/${f.name}`);
  }
  return out;
}
export async function remove(paths) {
  if (paths?.length) await exec("rm", ["-f", ...paths]).catch(() => null);
}
