import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Itinerary } from '@cruise/domain';
import { createItineraryStore } from './index';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const itinerary = (over: Partial<Itinerary> = {}): Itinerary => ({
  routeId: 'r1',
  provider: 'aida',
  readAt: '2026-01-01T00:00:00.000Z',
  stops: [
    { code: 'DEHAM', name: 'Hamburg', seaDay: false, arrival: null, departure: '2026-05-01T18:00:00' },
    { code: null, name: null, seaDay: true, arrival: null, departure: null },
  ],
  ...over,
});

describe('itineraryStore', () => {
  it('reads an unknown route as null', async () => {
    expect(await createItineraryStore(dir).get('nope')).toBeNull();
  });

  it('creates, keeps unchanged stops untouched and updates on a changed time', async () => {
    const store = createItineraryStore(dir);
    const first = itinerary();
    expect(await store.put(first)).toBe('created');

    const later = itinerary({ readAt: '2026-02-01T00:00:00.000Z' });
    expect(await store.put(later)).toBe('unchanged');
    const onDisk = JSON.parse(await readFile(join(dir, 'itineraries', 'r1.json'), 'utf8'));
    expect(onDisk.readAt).toBe(first.readAt);

    const changed = itinerary({
      readAt: '2026-03-01T00:00:00.000Z',
      stops: [{ ...first.stops[0]!, departure: '2026-05-01T19:00:00' }, first.stops[1]!],
    });
    expect(await store.put(changed)).toBe('updated');
    expect(await store.get('r1')).toEqual(changed);
  });

  it('removes twice without throwing', async () => {
    const store = createItineraryStore(dir);
    await store.put(itinerary());
    await store.remove('r1');
    await store.remove('r1');
    expect(await store.get('r1')).toBeNull();
  });

  it('rejects unsafe ids', async () => {
    const store = createItineraryStore(dir);
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/Invalid id/);
    await expect(store.put(itinerary({ routeId: '../x' }))).rejects.toThrow(/Invalid id/);
    await expect(store.remove('../x')).rejects.toThrow(/Invalid id/);
  });
});
