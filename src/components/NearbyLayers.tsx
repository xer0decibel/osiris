'use client';

import { Database, Download, Loader2 } from 'lucide-react';
import FloatingWindow from './FloatingWindow';
import type { NearbyResult } from '@/lib/arcgis-nearby';

/**
 * OSIRIS — the auto-find strip.
 *
 * A small window that lists what ArcGIS Online has for wherever the map is,
 * one click to import each, without opening the ArcGIS window. It exists only
 * while auto find is on; closing it switches auto find off, which is the
 * obvious way to make it go away.
 */
export default function NearbyLayers({ results, importingId, onImport, onClose }: {
  results: NearbyResult[];
  importingId: string | null;
  onImport: (r: NearbyResult) => void;
  onClose: () => void;
}) {
  return (
    <FloatingWindow
      className="fixed z-[390] right-2 bottom-[150px] w-[300px] flex flex-col"
      eyebrow="Auto find"
      meta={`${results.length} here`}
      icon={Database}
      title="Layers here"
      subtitle="ArcGIS Online, for this view"
      ariaLabel="Layers available here"
      onClose={onClose}
      closeLabel="Turn auto find off"
      bodyClassName="max-h-[40vh] overflow-y-auto styled-scrollbar"
    >
      {results.length === 0 ? (
        <p className="px-3 py-3 text-[10px] font-mono tracking-wider text-[var(--text-muted)]">Nothing found for this view yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {results.map(r => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-mono text-white/85 truncate" title={r.title}>{r.title}</div>
                <div className="text-[9px] font-mono tracking-wider text-[var(--text-muted)] truncate">{r.owner}</div>
              </div>
              <button
                onClick={() => onImport(r)}
                disabled={importingId !== null}
                className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono font-bold tracking-widest uppercase bg-[var(--gold-primary)]/10 border border-[var(--gold-primary)]/40 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/20 disabled:opacity-40 transition-colors"
                title={`Import ${r.title} for this view`}
              >
                {importingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </FloatingWindow>
  );
}
