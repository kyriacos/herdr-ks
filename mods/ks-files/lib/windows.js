// Floating windows (review windows, PR windows) and the key modes' resize keys. A window that has the keyboard says
// so in shared "ks.activeWindow" ({ key, mod }); the key strip notes it when it opens, and its resize keys then send
// the window a request: shared "ks.windowResize" ({ key, kind: "size" | "wide" | "tall", dir: ±1, reset, n }) and
// the command `<mod>.winresize`, which the window with that key carries out (by reopening itself at the new size).
// Source of truth: shared/windows.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared, run } from "herdr";

export const ACTIVE = "ks.activeWindow";
// Closing a window that has the keyboard: it stops being the active one first. A window that just goes away can't
// clear it itself (its timer goes with it), and a stale one would send the zoom and resize keys nowhere.
export function forget(key) { if (shared(ACTIVE)?.key === key) setShared(ACTIVE, null); }
export const REQUEST = "ks.windowResize";

// Keeps "ks.activeWindow" naming this window while its focus handle has the keyboard, and clears it when it loses
// it (checked every 400 ms; the strip reads it as it opens, before the window notices).
export function trackActive(view, cx, key, mod) {
  if (!key) return;
  cx.timer.every(400, () => {
    const a = shared(ACTIVE);
    if (view.handle?.is_focused()) { if (a?.key !== key) setShared(ACTIVE, { key, mod }); }
    else if (a?.key === key) setShared(ACTIVE, null);
  });
}

// The request for this window, once (each has a number), or null.
export function takeRequest(view, key) {
  const r = shared(REQUEST);
  if (!r || r.key !== key || r.n === view.__lastResize) return null;
  view.__lastResize = r.n;
  return r;
}

export function requestResize(win, kind, dir, reset) {
  setShared(REQUEST, { key: win.key, kind, dir, reset: Boolean(reset), n: Date.now() });
  run(`${win.mod}.winresize`);
}

// After a window reopened itself (it comes back on top), the key strip, if open, comes back over it.
export const raiseStrip = () => { if (shared("ks-keys.open")) run("ks-keys.raise"); };
