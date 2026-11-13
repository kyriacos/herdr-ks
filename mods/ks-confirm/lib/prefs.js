// ks preferences set in the settings panel (ks-settings), read by the mods they change. Shared state "ks.prefs".
// Source of truth: shared/prefs.js; scripts/install.sh copies it into each mod's lib/.
import { shared, setShared } from "herdr";

export const KEY = "ks.prefs";
export const DEFAULTS = {
  undoSeconds: 30,     // how long a closed tab or space can be brought back
  resumeCard: true,    // after a reboot, show the last Claude session's card in its terminal
  hideIdleMain: true,  // panels leave out a main checkout on main/master with nothing changed
  prToasts: true,      // My PRs: a toast when CI turns, a review lands, a PR merges
};
export const prefs = () => ({ ...DEFAULTS, ...(shared(KEY) ?? {}) });
export const pref = (k) => prefs()[k];
export const setPref = (k, v) => setShared(KEY, { ...(shared(KEY) ?? {}), [k]: v });
