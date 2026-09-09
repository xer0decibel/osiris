import { describe, it, expect } from 'vitest';
import { chooseBasemap, styleUrlFor, ONLINE_STYLE, OFFLINE_STYLE } from './basemap';

const NOW = 1_800_000_000_000;
const MINUTES = 60 * 1000;

/**
 * The precedence here is the whole point of the module: a machine with no
 * network must land on the offline basemap on its first frame, not after a
 * failed render, and an explicit choice must survive both.
 */
describe('chooseBasemap', () => {
  it('defaults to online, which has far more detail', () => {
    expect(chooseBasemap({ online: true, now: NOW })).toBe('online');
  });

  it('goes offline when the browser reports no connection', () => {
    expect(chooseBasemap({ online: false, now: NOW })).toBe('offline');
  });

  it('honours an explicit override over everything else', () => {
    expect(chooseBasemap({ online: true, override: 'offline', now: NOW })).toBe('offline');
    expect(chooseBasemap({ online: false, override: 'online', now: NOW })).toBe('online');
  });

  it('ignores an override it does not recognise', () => {
    expect(chooseBasemap({ online: true, override: 'satellite', now: NOW })).toBe('online');
    expect(chooseBasemap({ online: false, override: '', now: NOW })).toBe('offline');
  });

  it('remembers a recent CARTO failure so it fails once, not every load', () => {
    expect(chooseBasemap({ online: true, unreachableAt: NOW - 5 * MINUTES, now: NOW })).toBe('offline');
  });

  it('retries CARTO once the recorded failure is stale', () => {
    expect(chooseBasemap({ online: true, unreachableAt: NOW - 45 * MINUTES, now: NOW })).toBe('online');
  });

  it('treats an unreadable failure timestamp as no failure', () => {
    expect(chooseBasemap({ online: true, unreachableAt: NaN, now: NOW })).toBe('online');
    expect(chooseBasemap({ online: true, unreachableAt: null, now: NOW })).toBe('online');
  });

  it('assumes online where connectivity cannot be determined', () => {
    // Server-side render, or a browser without navigator.onLine.
    expect(chooseBasemap({ now: NOW })).toBe('online');
  });

  it('honours a deployment pin over the automatic checks', () => {
    // An appliance built offline must not go looking for CARTO merely because
    // the machine it was plugged into happens to have a connection.
    expect(chooseBasemap({ online: true, pin: 'offline', now: NOW })).toBe('offline');
    expect(chooseBasemap({ online: true, pin: 'offline', unreachableAt: null, now: NOW })).toBe('offline');
  });

  it('lets a human override the deployment pin', () => {
    // The pin is the image's default, not a lock: ?basemap=online still wins.
    expect(chooseBasemap({ online: true, pin: 'offline', override: 'online', now: NOW })).toBe('online');
    expect(chooseBasemap({ online: false, pin: 'online', override: 'offline', now: NOW })).toBe('offline');
  });

  it('ignores a pin it does not recognise rather than guessing', () => {
    expect(chooseBasemap({ online: true, pin: 'OFFLINE_PLEASE', now: NOW })).toBe('online');
    expect(chooseBasemap({ online: false, pin: '', now: NOW })).toBe('offline');
  });

  it('falls through to the automatic checks when unpinned', () => {
    expect(chooseBasemap({ online: false, pin: null, now: NOW })).toBe('offline');
    expect(chooseBasemap({ online: true, pin: null, now: NOW })).toBe('online');
  });

  it('maps each choice to a style that is actually served', () => {
    expect(styleUrlFor('online')).toBe(ONLINE_STYLE);
    expect(styleUrlFor('offline')).toBe(OFFLINE_STYLE);
    // Both are app-absolute so they resolve identically from any route.
    expect(ONLINE_STYLE.startsWith('/')).toBe(true);
    expect(OFFLINE_STYLE.startsWith('/')).toBe(true);
  });
});
