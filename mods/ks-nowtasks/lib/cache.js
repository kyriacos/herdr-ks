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
