/**
 * OSIRIS — which basemap the map draws on.
 *
 * The default basemap is CARTO's. Its style file is local but the only vector
 * source, the glyphs and the sprite are all remote, so without a connection the
 * map renders nothing — not a coarse map, a black rectangle. The offline style
 * beside it resolves entirely to files on disk.
 *
 * The choice is made *synchronously*, before the map is constructed. Swapping a
 * style afterwards is not an option: setStyle tears down every source and layer,
 * and this map adds around a hundred of them on style load. Waiting on a network
 * probe is not an option either — that is a stall on exactly the machine that
 * has no network to answer it.
 *
 * So the decision is made from what is already known, and a probe runs in the
 * background only to inform the *next* load:
 *
 *   1. An explicit override always wins  (?basemap=offline, or the stored flag)
 *   2. A deployment pin                  (OSIRIS_BASEMAP, served as a meta tag)
 *   3. navigator.onLine === false        — no connection, do not try
 *   4. CARTO failed on a previous load   — remembered, so it fails once not twice
 *   5. otherwise                         — online, which has far more detail
 *
 * Only the basemap is affected. Every intelligence layer is a separate live
 * feed and is untouched by this: on the offline basemap they simply stay empty
 * until there is a connection, then populate normally.
 */

export const ONLINE_STYLE = '/dark-matter-style.json';
export const OFFLINE_STYLE = '/offline/basemap-style.json';

const OVERRIDE_KEY = 'osiris:basemap';
const UNREACHABLE_KEY = 'osiris:basemap-unreachable';

/** A byte-sized CARTO asset; enough to prove the CDN answers. */
const PROBE_URL = 'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.json';
const PROBE_TIMEOUT_MS = 4000;

/** How long a recorded failure is honoured before CARTO is given another go. */
const UNREACHABLE_TTL_MS = 30 * 60 * 1000;

export type BasemapChoice = 'online' | 'offline';

export interface BasemapEnv {
  /** navigator.onLine, or undefined where it cannot be read. */
  online?: boolean;
  /** 'online' | 'offline' from the URL or storage; anything else is ignored. */
  override?: string | null;
  /** The deployment pin: OSIRIS_BASEMAP, served as a meta tag. Outranks the
   *  automatic checks, but not a human explicitly asking for the other one. */
  pin?: string | null;
  /** Epoch ms of the last recorded CARTO failure, if any. */
  unreachableAt?: number | null;
  now?: number;
}

/** Pure, so the precedence above is testable without a browser. */
export function chooseBasemap(env: BasemapEnv): BasemapChoice {
  if (env.override === 'offline') return 'offline';
  if (env.override === 'online') return 'online';
  if (env.pin === 'offline') return 'offline';
  if (env.pin === 'online') return 'online';
  if (env.online === false) return 'offline';
  const at = env.unreachableAt;
  const now = env.now ?? Date.now();
  if (typeof at === 'number' && Number.isFinite(at) && now - at < UNREACHABLE_TTL_MS) return 'offline';
  return 'online';
}

export function styleUrlFor(choice: BasemapChoice): string {
  return choice === 'offline' ? OFFLINE_STYLE : ONLINE_STYLE;
}

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Blocked or full. The choice still works, it just is not remembered. */
  }
}

/** `?basemap=offline` pins it for a session; the stored value pins it for good. */
function readOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('basemap');
    if (q === 'offline' || q === 'online') return q;
  } catch { /* malformed query string */ }
  const stored = readStorage(OVERRIDE_KEY);
  return stored === 'offline' || stored === 'online' ? stored : null;
}

/**
 * The deployment pin, rendered into the document by the root layout from
 * OSIRIS_BASEMAP.
 *
 * A meta tag rather than storage, because storage is per browser profile — an
 * appliance would have to be configured on every machine it was ever plugged
 * into. A meta tag rather than a fetch, because this has to resolve before the
 * map is constructed. And read at request time rather than baked in with
 * NEXT_PUBLIC_, so one image can be flipped without rebuilding it.
 */
function readPin(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('meta[name="osiris:basemap"]');
  const v = el?.getAttribute('content')?.trim().toLowerCase() ?? null;
  return v === 'offline' || v === 'online' ? v : null;
}

/** Resolved synchronously at construction time. */
export function resolveBasemapStyle(): string {
  const raw = readStorage(UNREACHABLE_KEY);
  const unreachableAt = raw === null ? null : Number(raw);
  return styleUrlFor(
    chooseBasemap({
      online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
      override: readOverride(),
      pin: readPin(),
      unreachableAt,
    }),
  );
}

/**
 * Runs after the map is already up, and changes nothing about this load — it
 * only records whether CARTO answered, so the *next* start picks correctly. A
 * machine that boots without a network therefore gets the offline basemap
 * immediately rather than after one failed render.
 */
export async function probeBasemapReachability(): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const res = await fetch(PROBE_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(String(res.status));
    writeStorage(UNREACHABLE_KEY, null);
    return true;
  } catch {
    writeStorage(UNREACHABLE_KEY, String(Date.now()));
    return false;
  }
}

/** Pin the basemap, or pass null to go back to automatic selection. */
export function setBasemapOverride(choice: BasemapChoice | null): void {
  writeStorage(OVERRIDE_KEY, choice);
}
