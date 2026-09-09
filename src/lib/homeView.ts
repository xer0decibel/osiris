/**
 * OSIRIS — where the map opens.
 *
 * The map used to start on a hardcoded point in central Bulgaria and only move
 * once an IP lookup came back, three seconds later. That lookup is easy to miss:
 * it is cancelled by the first click or keypress so a late response cannot yank
 * the camera away, and it fails outright whenever /api/geo does. Miss it and you
 * are left looking at someone else's country with no indication why.
 *
 * So the resolved location is remembered. A repeat visit opens where the last
 * lookup put you, with no wrong-place flash and no dependence on the lookup
 * succeeding this time. Absent that, the fallback is the whole world rather than
 * an arbitrary country — the honest answer to "we do not know where you are".
 */

export interface HomeView {
  lat: number;
  lng: number;
  zoom: number;
}

const KEY = 'osiris:home-view';

/** Matches the app's own reset-view shortcut, so "no idea" and "reset" agree. */
export const DEFAULT_VIEW: HomeView = { lat: 20, lng: 0, zoom: 2.5 };

/** The map's configured limits; a stored zoom outside them would be rejected. */
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 18;

export function isValidView(v: unknown): v is HomeView {
  if (!v || typeof v !== 'object') return false;
  const { lat, lng, zoom } = v as Record<string, unknown>;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180 &&
    typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM
  );
}

/**
 * Every access is guarded: storage is unavailable in private windows and can be
 * blocked outright, and a half-written or hand-edited value must not be able to
 * stop the map from loading. Anything unreadable is treated as absent.
 */
export function readHomeView(): HomeView | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidView(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeHomeView(view: HomeView): void {
  if (typeof window === 'undefined') return;
  if (!isValidView(view)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    /* Storage full or blocked. The map still works, it just will not remember. */
  }
}
