import { NextResponse } from 'next/server';

/**
 * OSIRIS — live traffic, via TomTom's Traffic Flow tiles.
 *
 * There is no keyless source of live congestion anywhere; every provider gates
 * it behind an API key. TomTom's is free to obtain and its free tier allows
 * 2,500 tile requests a day — enough to look at a city, not to pan the world —
 * under terms that are for evaluation and non-commercial use. So, like the
 * Cloudflare layers, this is a capability: set TOMTOM_API_KEY and the layer
 * appears in the panel; leave it unset and nothing is offered.
 *
 * The key never reaches the browser. Tiles go through /api/traffic/tile,
 * which adds it server-side.
 */
export const dynamic = 'force-dynamic';

function isConfigured(): boolean {
  return Boolean(process.env.TOMTOM_API_KEY);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('probe') === '1') {
    return NextResponse.json({ configured: isConfigured(), source: 'TomTom Traffic' });
  }
  return NextResponse.json({
    configured: isConfigured(),
    tiles: isConfigured() ? '/api/traffic/tile/{z}/{x}/{y}' : null,
    note: isConfigured() ? undefined : 'Set TOMTOM_API_KEY to enable live traffic.',
  }, { status: isConfigured() ? 200 : 404 });
}
