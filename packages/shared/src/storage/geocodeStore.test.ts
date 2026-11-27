import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGeocodeStore, createStores } from './index';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('geocodeStore', () => {
  it('round-trips a hit and a miss in one file', async () => {
    const store = createGeocodeStore(dir);
    const hit = { lat: -4.62, lng: 55.45, source: 'osm' as const, at: '2026-11-27T10:00:00.000Z' };
    const miss = { miss: true as const, at: '2026-11-27T10:00:00.000Z' };
    await store.put('sc|port victoria', hit);
    await store.put('-|santa cruz', miss);
    expect(await store.get('sc|port victoria')).toEqual(hit);
    expect(await store.get('-|santa cruz')).toEqual(miss);
    expect(await store.get('sc|unknown')).toBeNull();
    expect(JSON.parse(await readFile(join(dir, 'geocode-cache.json'), 'utf8'))).toHaveProperty(['sc|port victoria']);
  });

  it('reads a missing file as empty', async () => {
    expect(await createGeocodeStore(dir).get('x')).toBeNull();
  });

  it('treats a corrupt file as empty and can write again', async () => {
    await writeFile(join(dir, 'geocode-cache.json'), '{not json');
    const store = createGeocodeStore(dir);
    expect(await store.get('x')).toBeNull();
    const miss = { miss: true as const, at: '2026-11-27T10:00:00.000Z' };
    await store.put('x', miss);
    expect(await store.get('x')).toEqual(miss);
  });

  it('is part of createStores', async () => {
    expect(await createStores(dir).geocodes.get('x')).toBeNull();
  });
});
