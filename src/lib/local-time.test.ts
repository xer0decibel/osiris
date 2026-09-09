import { describe, it, expect } from 'vitest';
import { localTimeAt, zoneAt } from './local-time';

// A fixed instant, so daylight saving is a known quantity: 9 July 2026, 17:00Z.
const JULY = new Date('2026-07-09T17:00:00Z');

describe('zoneAt', () => {
  it('names the political zone on land and the nautical zone at sea', () => {
    expect(zoneAt(47.6, -122.3)).toBe('America/Los_Angeles');
    expect(zoneAt(51.5, -0.1)).toBe('Europe/London');
    expect(zoneAt(35.7, 139.7)).toBe('Asia/Tokyo');
    expect(zoneAt(0, -30)).toBe('Etc/GMT+2');
  });

  it('returns null off the edge of the world rather than throwing', () => {
    expect(zoneAt(95, 0)).toBeNull();
    expect(zoneAt(0, 400)).toBeNull();
  });
});

describe('localTimeAt', () => {
  it('applies the zone offset, daylight saving included', () => {
    // 17:00Z in July: Seattle is UTC-7, London UTC+1, Tokyo UTC+9.
    expect(localTimeAt(47.6, -122.3, JULY)?.time).toBe('10:00');
    expect(localTimeAt(51.5, -0.1, JULY)?.time).toBe('18:00');
    expect(localTimeAt(35.7, 139.7, JULY)?.time).toBe('02:00');
  });

  it('labels the zone the way an American reader would see it', () => {
    // US zones by their names; everywhere else as an offset from GMT.
    expect(localTimeAt(47.6, -122.3, JULY)?.abbr).toBe('PDT');
    expect(localTimeAt(51.5, -0.1, JULY)?.abbr).toBe('GMT+1');
    expect(localTimeAt(35.7, 139.7, JULY)?.abbr).toBe('GMT+9');
    expect(localTimeAt(47.6, -122.3, JULY)?.label).toBe('10:00 PDT');
  });

  it('answers with the nautical zone at sea', () => {
    // Etc/GMT+2 is two hours behind UTC, by POSIX's inverted sign.
    const sea = localTimeAt(0, -30, JULY);
    expect(sea?.time).toBe('15:00');
    expect(sea?.abbr).toMatch(/GMT-2/);
  });

  it('uses a 24-hour clock with no 24:00', () => {
    // 00:30 in Tokyo is 15:30Z the day before.
    expect(localTimeAt(35.7, 139.7, new Date('2026-07-09T15:30:00Z'))?.time).toBe('00:30');
  });

  it('is null off the edge of the world', () => {
    expect(localTimeAt(95, 0, JULY)).toBeNull();
  });
});
