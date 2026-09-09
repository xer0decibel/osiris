'use client';

import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Sun, AlertTriangle, Camera,
  CloudLightning, Ship, Network, Database, Ghost,
  Flame, Tv, Radio, Mountain, Anchor, Megaphone, SlidersHorizontal, CloudRain,
  Globe, MapPinned, Moon
} from 'lucide-react';
import StyleStudio from './StyleStudio';
import { TERRAIN_MIN_ZOOM, type TerrainStatus } from '@/lib/map-terrain';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  isMobile?: boolean;
  theme?: 'core' | 'ghost';
  setTheme?: (theme: 'core' | 'ghost') => void;
  /** Server-side capabilities, e.g. { cloudflare: true }. Layers declaring a
   *  `requires` key stay hidden until the matching capability is present. */
  capabilities?: Record<string, boolean>;
  terrainStatus?: TerrainStatus;
  onTerrainRetry?: () => void;
  onTerrainFocus?: () => void;
  on3DModeSelected?: () => void;
  /** The map's projection and imagery, shown at the top of the rail as two
   *  toggles. Each shows the state the map is in and switches to the other.
   *  Omitted, the rail simply starts at the layer groups. */
  mapProjection?: 'globe' | 'mercator';
  onToggleProjection?: () => void;
  mapStyle?: 'dark' | 'satellite';
  onToggleStyle?: () => void;
}

/**
 * One button for a two-state setting. It shows the state the map is in and
 * switches to the other — two of these replaced a four-segment strip, where a
 * segment for each state said the same thing twice.
 */
function ViewToggle({ icon: Icon, label, title, onClick, wide }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  title: string;
  onClick: () => void;
  /** Mobile: a full-width pill in a row, not a rail tile. */
  wide?: boolean;
}) {
  if (wide) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-[10px] font-mono tracking-[0.18em] text-white/70"
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
    >
      <Icon style={{ width: 16, height: 16, color: 'rgba(255,255,255,0.75)' }} />
    </button>
  );
}

interface LayerDef {
  key: string;
  label: string;
  dataKey: string;
  description?: string;
  /** Reads a bucket out of data.category_counts instead of a top-level array. */
  catKey?: string;
  /** Capability that must be configured server-side for this layer to appear. */
  requires?: string;
  /** Key of the layer this one modifies. Renders indented beneath it, and reads
   *  as inert while that parent is off — it has nothing to act on. */
  parent?: string;
}

interface LayerGroupDef {
  label: string;
  fullLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  layers: LayerDef[];
}

const LAYER_GROUPS: LayerGroupDef[] = [
  {
    label: 'SDK',
    fullLabel: 'OSIRIS SDK',
    icon: Network,
    layers: [
      { key: 'sdk_sea', label: 'Maritime Lines', dataKey: 'sdk_entities' },
    ],
  },
  {
    label: 'AVIATION',
    fullLabel: 'AVIATION',
    icon: Plane,
    layers: [
      { key: 'flights', label: 'Commercial', dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', dataKey: 'private_jets' },
      { key: 'military', label: 'Military', dataKey: 'military_flights' },
    ],
  },
  {
    label: 'MARITIME',
    fullLabel: 'MARITIME',
    icon: Ship,
    layers: [
      { key: 'maritime', label: 'Maritime / Naval', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
    ],
  },
  {
    label: 'SPACE',
    fullLabel: 'SPACE TRACKING',
    icon: Satellite,
    layers: [
      { key: 'satellites', label: 'All Satellites', dataKey: 'satellites' },
      { key: 'sat_comms', label: 'Starlink / Comms', dataKey: 'satellites', catKey: 'comms' },
      { key: 'sat_military', label: 'Military / Intel', dataKey: 'satellites', catKey: 'military' },
      { key: 'sat_navigation', label: 'GPS / Navigation', dataKey: 'satellites', catKey: 'navigation' },
      { key: 'sat_earth', label: 'Earth Observation', dataKey: 'satellites', catKey: 'earth_obs' },
      { key: 'sat_science', label: 'Stations / Telescopes', dataKey: 'satellites', catKey: 'science' },
    ],
  },
  {
    label: 'SURVEIL',
    fullLabel: 'SURVEILLANCE',
    icon: Camera,
    layers: [
      { key: 'cctv', label: 'CCTV Cameras', dataKey: 'cameras' },
      { key: 'cctv_previews', label: 'Live Previews', dataKey: '', parent: 'cctv' },
      { key: 'live_news', label: 'Live News Feeds', dataKey: 'live_feeds' },
    ],
  },
  {
    label: 'RADIO',
    fullLabel: 'BROADCAST RADIO',
    icon: Radio,
    layers: [
      { key: 'radio', label: 'Radio Stations', description: 'Live streams by transmitter', dataKey: 'radio_stations' },
    ],
  },
  {
    label: 'TV',
    fullLabel: 'BROADCAST TV',
    icon: Tv,
    layers: [
      { key: 'tv', label: 'TV Channels', description: 'Live streams by country', dataKey: 'tv_countries' },
    ],
  },
  {
    label: 'WX',
    fullLabel: 'WEATHER IMAGERY',
    icon: CloudRain,
    layers: [
      { key: 'wx_radar', label: 'Precipitation Radar', description: 'Animated · last 2 hours', dataKey: '' },
      { key: 'wx_clouds', label: 'Cloud Imagery', description: 'VIIRS true colour · daily', dataKey: '' },
    ],
  },
  {
    label: 'HAZARD',
    fullLabel: 'NATURAL HAZARDS',
    icon: CloudLightning,
    layers: [
      { key: 'earthquakes', label: 'Earthquakes', dataKey: 'earthquakes' },
      { key: 'fires', label: 'Active Fires', description: 'NASA FIRMS hotspots · global', dataKey: 'fires' },
      { key: 'fire_incidents', label: 'Named Incidents', description: 'NIFC acres + containment · US', dataKey: 'fire_incidents' },
      { key: 'fire_perimeters', label: 'Fire Perimeters', description: 'Mapped burn outline · US', dataKey: '' },
      { key: 'weather', label: 'Severe Weather', dataKey: 'weather_events' },
    ],
  },
  {
    label: 'THREAT',
    fullLabel: 'THREATS & INTEL',
    icon: AlertTriangle,
    layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', dataKey: 'infrastructure' },
      { key: 'global_incidents', label: 'Global Incidents', dataKey: 'gdelt' },
      { key: 'gdelt_events', label: 'GDELT Events', dataKey: 'gdelt_events' },
    ],
  },
  {
    label: 'NETWORK',
    fullLabel: 'NETWORK INTEL',
    icon: Network,
    layers: [
      { key: 'malware', label: 'Live Malware', dataKey: 'malware_threats' },
      { key: 'cyber_attacks', label: 'Live Attacks', dataKey: 'cyber_attacks' },
    ],
  },
  {
    label: 'NETINTEL',
    fullLabel: 'NET & EVENT INTEL',
    icon: Megaphone,
    layers: [
      { key: 'cf_outages', label: 'Internet Outages', dataKey: 'cf_outages', requires: 'cloudflare' },
      { key: 'cf_attacks', label: 'Attack Origins', dataKey: 'cf_attack_origins', requires: 'cloudflare' },
    ],
  },
  {
    label: 'DISPLAY',
    fullLabel: 'DISPLAY',
    icon: Sun,
    layers: [
      { key: 'day_night', label: 'Day / Night Cycle', dataKey: '' },
      { key: 'terrain_3d', label: '3D Buildings', description: 'City detail · zoom 14.5+', dataKey: '' },
      { key: 'terrain_elevation', label: '3D Terrain', description: 'Mountains · zoom 10+', dataKey: '' },
    ],
  },
];

/* ── Minimal Toggle Switch ── */
/**
 * Presentational only. The row around it is the button, and a button inside a
 * button is invalid HTML — the browser reparents it, which breaks hydration and
 * silently drops the click handler on the inner control.
 */
function ToggleSwitch({ active }: { active: boolean }) {
  return (
    <span
      role="presentation"
      className="relative flex-shrink-0 block"
      style={{ width: 28, height: 14 }}
    >
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
          border: active ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)',
          boxShadow: active ? '0 0 8px rgba(255,255,255,0.1)' : 'none',
        }}
      />
      <motion.div
        className="absolute top-[2px] rounded-full"
        style={{
          width: 10,
          height: 10,
          background: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)',
          boxShadow: active ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
        }}
        animate={{ left: active ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </span>
  );
}

/**
 * The elbow that ties a sub-layer row to the layer above it. Indentation alone
 * reads as a typo at this size; the line is what says "this belongs to that".
 */
function SubLayerStem() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-[6px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-white/[0.14]"
    />
  );
}

function LayerPanel({ data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme, capabilities = {}, terrainStatus = 'idle', onTerrainRetry, onTerrainFocus, on3DModeSelected, mapProjection, onToggleProjection, mapStyle, onToggleStyle }: LayerPanelProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const viewToggles = (mapProjection && onToggleProjection) || (mapStyle && onToggleStyle) ? (
    <>
      {mapProjection && onToggleProjection && (
        <ViewToggle
          wide={isMobile}
          onClick={onToggleProjection}
          icon={mapProjection === 'globe' ? Globe : MapPinned}
          label={mapProjection === 'globe' ? '3D' : '2D'}
          title={mapProjection === 'globe' ? '3D globe — switch to the 2D map' : '2D map — switch to the 3D globe'}
        />
      )}
      {mapStyle && onToggleStyle && (
        <ViewToggle
          wide={isMobile}
          onClick={onToggleStyle}
          icon={mapStyle === 'dark' ? Moon : Satellite}
          label={mapStyle === 'dark' ? 'MAP' : 'SAT'}
          title={mapStyle === 'dark' ? 'Night map — switch to satellite imagery' : 'Satellite imagery — switch to the night map'}
        />
      )}
    </>
  ) : null;
  /**
   * A pinned group stays open when the pointer leaves. Hover-only flyouts are
   * fine to glance at and impossible to work in — reaching for a toggle at the
   * far edge closes the thing you were reaching for.
   */
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);

  useEffect(() => {
    if (!pinnedGroup) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedGroup]);

  const toggle = (key: string) => {
    if ((key === 'terrain_elevation' || key === 'terrain_3d') && !activeLayers[key]) on3DModeSelected?.();
    setActiveLayers((prev: any) => ({ ...prev, [key]: !prev[key] }));
  };
  const terrainDetails = activeLayers.terrain_elevation ? (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[10px] text-white/60">
      <p role="status">{terrainStatus === 'idle' ? `Terrain at zoom ${TERRAIN_MIN_ZOOM}+ · zoom in` : terrainStatus === 'waiting' ? 'Terrain starts when you stop moving' : terrainStatus === 'loading' ? 'Loading nearby terrain…' : terrainStatus === 'error' ? 'Terrain unavailable; the map is still usable.' : 'Terrain on'}</p>
      {terrainStatus === 'idle' && <button type="button" onClick={onTerrainFocus} className="mt-2 min-h-8 rounded border border-white/15 px-2 text-[var(--gold-primary)] hover:bg-white/10">Zoom to terrain</button>}
      {terrainStatus === 'error' && <button type="button" onClick={onTerrainRetry} className="mt-2 min-h-8 rounded border border-white/15 px-2 text-[var(--gold-primary)] hover:bg-white/10">Retry terrain</button>}
      <p className="mt-2 text-white/35">Nearby detail only · cached tiles</p>
      <a className="mt-1 inline-block underline underline-offset-2" href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Terrain credits</a>
    </div>
  ) : null;

  /** Switch a whole group at once — off if any are on, otherwise all on. */
  const toggleGroup = (layers: LayerDef[]) => {
    const anyOn = layers.some(l => activeLayers[l.key]);
    if (!anyOn && layers.some(l => l.key === 'terrain_elevation' || l.key === 'terrain_3d')) on3DModeSelected?.();
    setActiveLayers((prev: any) => {
      const next = { ...prev };
      for (const l of layers) next[l.key] = !anyOn;
      return next;
    });
  };

  /* Drop layers whose backing capability is not configured, then drop any group
     left with nothing to show. */
  const visibleGroups = LAYER_GROUPS.map(g => ({
    ...g,
    layers: g.layers.filter(l => !l.requires || capabilities[l.requires]),
  })).filter(g => g.layers.length > 0);

  const getCount = (dk: string, catKey?: string): number | null => {
    if (!dk) return null;
    if (catKey && data.category_counts) {
      return data.category_counts[catKey] || 0;
    }
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      if (data[k] && Array.isArray(data[k])) {
        total += data[k].length;
        found = true;
      }
    }
    return found ? total : null;
  };

  /* ── MOBILE ── */
  if (isMobile) {
    return (
      <div className="flex flex-col gap-5 py-2">
        {viewToggles && <div className="flex gap-2 px-1">{viewToggles}</div>}
        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30 border-b border-white/[0.06] pb-1.5">
              {group.fullLabel}
            </div>
            <div className="flex flex-col gap-1">
              {group.layers.map((layer) => {
                const isLayerActive = activeLayers[layer.key];
                const count = getCount(layer.dataKey, layer.catKey);
                const dormant = !!layer.parent && !activeLayers[layer.parent];
                return (
                  <button
                    key={layer.key}
                    onClick={() => toggle(layer.key)}
                    aria-pressed={!!isLayerActive}
                    aria-label={layer.label}
                    className={`relative w-full flex items-center gap-3 py-2 rounded-md text-left hover:bg-white/[0.04] transition-colors ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
                  >
                    {layer.parent && <SubLayerStem />}
                    <ToggleSwitch active={!!isLayerActive} />
                    <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors ${isLayerActive ? 'text-white/80' : 'text-white/40'}`}>
                      {layer.label}
                      {layer.description && <span className="block mt-0.5 text-[9px] normal-case tracking-normal text-white/35">{layer.description}</span>}
                    </span>
                    {count !== null && (
                      <span className="text-[10px] font-mono tabular-nums text-white/25">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
              {group.label === 'DISPLAY' && terrainDetails}
            </div>
          </div>
        ))}

        {/* MOBILE STYLE STUDIO */}
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/[0.06] px-1">
          <span className="text-[10px] font-mono tracking-[0.2em] text-white/25 uppercase">Style Studio</span>
          <button
            onClick={() => setStudioOpen(o => !o)}
            aria-pressed={studioOpen}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{
              background: studioOpen ? 'var(--hover-accent)' : 'transparent',
              boxShadow: studioOpen ? '0 0 12px var(--gold-glow)' : 'none',
            }}
          >
            <SlidersHorizontal className="w-4 h-4" style={{ color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.25)' }} />
          </button>
        </div>
        <AnimatePresence>
          {studioOpen && <StyleStudio isMobile onClose={() => setStudioOpen(false)} />}
        </AnimatePresence>

        {/* MOBILE GHOST TOGGLE */}
        {setTheme && (
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] px-1">
            <span className="text-[10px] font-mono tracking-[0.2em] text-white/25 uppercase">Ghost Protocol</span>
            <button
              onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.15)' : 'transparent',
                boxShadow: theme === 'ghost' ? '0 0 12px rgba(179, 136, 255, 0.3)' : 'none',
              }}
            >
              <Ghost className="w-4 h-4" style={{ color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.25)' }} />
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── DESKTOP ── */
  return (
    <motion.div
      /* The vertical centring rides on framer's own transform: a Tailwind
         -translate-y-1/2 would be overwritten the moment the slide-in animates. */
      initial={{ x: -60, y: '-50%', opacity: 0 }}
      animate={{ x: 0, y: '-50%', opacity: 1 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200, delay: 2.8 }}
      /* Same pill as the tool rail on the right: floating, centred, rounded. */
      className="absolute left-2 top-1/2 flex flex-col items-center gap-2 z-50 pointer-events-auto bg-black/40 backdrop-blur-sm p-1 rounded-full border border-white/5"
    >
      {/* The two view toggles sit at the top of the rail, above the groups. */}
      {viewToggles && (
        <>
          <div className="flex flex-col items-center gap-2">{viewToggles}</div>
          <div className="w-4 h-px bg-white/10" />
        </>
      )}
      {/* One flow, one gap: the utilities below follow the groups at the same
          spacing rather than being pushed to the foot of the rail. */}
      <div className="flex flex-col items-center gap-2">
        {visibleGroups.map((group) => {
          /* Sub-layers modify a parent rather than draw anything of their own,
             so they do not count towards the rail's reading. */
          const counted = group.layers.filter(l => !l.parent);
          const groupActive = counted.some(l => activeLayers[l.key]);
          const isHovered = hoveredGroup === group.label;
          const Icon = group.icon;

          const activeCount = counted.filter(l => activeLayers[l.key]).length;
          const isPinned = pinnedGroup === group.label;
          const isOpen = isHovered || isPinned;

          return (
            <div
              key={group.label}
              className="relative flex items-center justify-center"
              onMouseEnter={() => setHoveredGroup(group.label)}
              onMouseLeave={() => setHoveredGroup(null)}
            >
              {/* A real button, not a div: this is keyboard reachable, focusable
                  and announced. Clicking pins the flyout open so it can be
                  worked in rather than only glanced at. */}
              <button
                onClick={() => setPinnedGroup(isPinned ? null : group.label)}
                aria-expanded={isOpen}
                aria-label={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
                title={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
                className="relative w-8 h-8 flex items-center justify-center cursor-pointer rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                style={{
                  background: isPinned
                    ? 'rgba(255,255,255,0.10)'
                    : isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                <Icon
                  className="transition-all duration-300"
                  style={{
                    width: 16,
                    height: 16,
                    /* The icon itself is the reading: lit cyan while anything
                       in the group is on, the same cyan the badge used to be.
                       The count survives in the title and the aria-label. */
                    color: groupActive
                      ? 'rgba(0,229,255,0.95)'
                      : isOpen
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(255,255,255,0.22)',
                    filter: groupActive ? 'drop-shadow(0 0 5px rgba(0,229,255,0.55))' : 'none',
                  }}
                />
              </button>

              {/* Flyout (LEFT side) */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="absolute left-[44px] top-1/2 -translate-y-1/2 min-w-[220px] rounded-xl p-3 z-[100] pointer-events-auto"
                    style={{
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(40px) saturate(1.5)',
                      WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2.5 pb-1.5 border-b border-white/[0.04]">
                      <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/35 flex-1">
                        {group.fullLabel}
                      </span>
                      {/* Switching eight satellite layers one at a time is the
                          kind of thing that makes a panel feel unfinished. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGroup(group.layers); }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        {activeCount > 0 ? 'NONE' : 'ALL'}
                      </button>
                      {isPinned && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPinnedGroup(null); }}
                          aria-label="Close"
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {group.layers.map((layer) => {
                        const isLayerActive = activeLayers[layer.key];
                        const count = getCount(layer.dataKey, layer.catKey);
                        const dormant = !!layer.parent && !activeLayers[layer.parent];

                        return (
                          <button
                            key={layer.key}
                            onClick={() => toggle(layer.key)}
                            aria-pressed={!!isLayerActive}
                            aria-label={layer.label}
                            title={dormant ? 'Turn the layer above on to use this' : undefined}
                            className={`relative w-full flex items-center gap-3 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
                          >
                            {layer.parent && <SubLayerStem />}
                            <ToggleSwitch active={!!isLayerActive} />
                            <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors duration-200 ${isLayerActive ? 'text-white/70' : 'text-white/35'}`}>
                              {layer.label}
                              {layer.description && <span className="block mt-0.5 text-[9px] normal-case tracking-normal text-white/35">{layer.description}</span>}
                            </span>
                            {count !== null && (
                              <span className={`text-[10px] font-mono tabular-nums transition-colors ${isLayerActive ? 'text-white/45' : 'text-white/20'}`}>
                                {count.toLocaleString()}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {group.label === 'DISPLAY' && terrainDetails}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Subtle separator */}
      <div className="w-4 h-px bg-white/10" />

      {/* Style Studio */}
      <button
        onClick={() => setStudioOpen(o => !o)}
        aria-pressed={studioOpen}
        className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-500 cursor-pointer"
        style={{ background: studioOpen ? 'var(--hover-accent)' : 'transparent' }}
        title="Style Studio"
      >
        <SlidersHorizontal
          className="transition-all duration-500"
          style={{
            width: 15,
            height: 15,
            color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.15)',
            filter: studioOpen ? 'drop-shadow(0 0 6px var(--gold-glow))' : 'none',
          }}
        />
      </button>
      <AnimatePresence>
        {studioOpen && <StyleStudio onClose={() => setStudioOpen(false)} />}
      </AnimatePresence>

      {/* Ghost Protocol Toggle */}
      {setTheme && (
        <button
          onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-500 cursor-pointer"
          style={{
            background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.1)' : 'transparent',
          }}
          title="Ghost Protocol"
        >
          <Ghost
            className="transition-all duration-500"
            style={{
              width: 15,
              height: 15,
              color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.15)',
              filter: theme === 'ghost' ? 'drop-shadow(0 0 6px rgba(179, 136, 255, 0.5))' : 'none',
            }}
          />
        </button>
      )}
    </motion.div>
  );
}

export default memo(LayerPanel);
