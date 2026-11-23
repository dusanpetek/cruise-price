import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, createAlertRuleStore, createAlertStore, createConfigStore, createWeeklyReportStore } from './index';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('alertRuleStore', () => {
  it('creates, lists and removes rules', async () => {
    const store = createAlertRuleStore(dir);
    const a = await store.create({ type: 'TARGET_PRICE', targetPrice: 2499, cabin: 'balcony' });
    await store.create({ type: 'PERCENT_DROP', percent: 15 });
    expect((await store.list()).map((r) => r.type)).toEqual(['TARGET_PRICE', 'PERCENT_DROP']);
    await store.remove(a.id);
    expect((await store.list()).map((r) => r.type)).toEqual(['PERCENT_DROP']);
    await expect(store.remove(a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects invalid rules', async () => {
    await expect(createAlertRuleStore(dir).create({ type: 'PERCENT_DROP', percent: 7 })).rejects.toThrow();
  });

  it('creates the default rules once; deleting them sticks', async () => {
    const store = createAlertRuleStore(dir);
    await store.ensureDefaults();
    const defaults = await store.list();
    expect(defaults.map((r) => [r.type, r.percent, r.routeId, r.cabin])).toEqual([['NEW_LOW', null, null, null], ['PERCENT_DROP', 10, null, null]]);
    await store.ensureDefaults();
    expect(await store.list()).toHaveLength(2);
    for (const r of defaults) await store.remove(r.id);
    await store.ensureDefaults();
    expect(await store.list()).toEqual([]);
  });

  it('does not add defaults to a store that already has rules', async () => {
    const store = createAlertRuleStore(dir);
    await store.create({ type: 'NEW_LOW', cabin: 'suite' });
    await store.ensureDefaults();
    expect(await store.list()).toHaveLength(1);
  });

  it('skips unreadable rule files', async () => {
    const store = createAlertRuleStore(dir);
    await store.create({ type: 'NEW_LOW' });
    await writeFile(join(dir, 'alert-rules', 'junk.json'), 'nope');
    expect(await store.list()).toHaveLength(1);
    expect(await createAlertRuleStore(join(dir, 'missing')).list()).toEqual([]);
  });
});

describe('alertStore', () => {
  const input = { ruleId: 'r', routeId: 'route-1', routeName: 'AIDA Nova', provider: 'aida', type: 'NEW_LOW', category: 'Balcony', currentPrice: 2399, referencePrice: 2499, message: 'New historical low detected.', snapshotId: 's1' } as const;

  it('stores alerts as new and lists them newest first', async () => {
    const store = createAlertStore(dir);
    await store.create({ ...input, createdAt: '2026-01-01T00:00:00.000Z' });
    const second = await store.create({ ...input, createdAt: '2026-01-02T00:00:00.000Z', type: 'PERCENT_DROP', provider: 'mein-schiff' });
    expect(second).toMatchObject({ status: 'new', deliveries: [] });
    expect((await store.list()).map((a) => a.createdAt)).toEqual(['2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
  });

  it('filters by provider, type and date, and limits', async () => {
    const store = createAlertStore(dir);
    await store.create({ ...input, createdAt: '2026-01-01T00:00:00.000Z' });
    await store.create({ ...input, createdAt: '2026-01-05T00:00:00.000Z', type: 'PERCENT_DROP', provider: 'mein-schiff' });
    expect(await store.list({ provider: 'aida' })).toHaveLength(1);
    expect((await store.list({ type: 'PERCENT_DROP' }))[0]!.provider).toBe('mein-schiff');
    expect(await store.list({ since: '2026-01-03T00:00:00.000Z' })).toHaveLength(1);
    expect(await store.list({}, 1)).toHaveLength(1);
  });

  it('records delivery results and acknowledgement', async () => {
    const store = createAlertStore(dir);
    const a = await store.create(input);
    const delivered = await store.setDeliveries(a.id, [{ channel: 'email', status: 'failed', attempts: 3, error: 'Email: ECONNREFUSED' }]);
    expect(delivered.deliveries[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect((await store.acknowledge(a.id)).status).toBe('acknowledged');
    expect((await store.get(a.id)).deliveries).toHaveLength(1); // acknowledging keeps the delivery log
  });

  it('reports unknown alerts and rejects invalid ones', async () => {
    const store = createAlertStore(dir);
    await expect(store.get('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.acknowledge('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.create({ ...input, currentPrice: -1 })).rejects.toThrow();
    await expect(store.get('../x')).rejects.toThrow(/Invalid id/);
  });

  it('is empty without an alerts folder and skips junk files', async () => {
    expect(await createAlertStore(dir).list()).toEqual([]);
    await createAlertStore(dir).create(input);
    await writeFile(join(dir, 'alerts', 'junk.json'), '{}');
    expect(await createAlertStore(dir).list()).toHaveLength(1);
  });
});

describe('weeklyReportStore', () => {
  it('writes the formats and reads them back, newest first', async () => {
    const store = createWeeklyReportStore(dir);
    expect(await store.list()).toEqual([]);
    expect(await store.write('2026-01-05', { json: '{"a":1}', csv: 'a\n1\n', pdf: Buffer.from('%PDF') })).toEqual(['weekly-2026-01-05.json', 'weekly-2026-01-05.csv', 'weekly-2026-01-05.pdf']);
    await store.write('2026-01-12', { json: '{}', csv: '' });
    expect(await store.list()).toEqual(['weekly-2026-01-12.json', 'weekly-2026-01-12.csv', 'weekly-2026-01-05.pdf', 'weekly-2026-01-05.json', 'weekly-2026-01-05.csv']);
    expect((await store.read('weekly-2026-01-05.json'))!.data.toString()).toBe('{"a":1}');
    expect((await store.read('weekly-2026-01-05.csv'))!.contentType).toContain('text/csv');
    expect((await store.read('weekly-2026-01-05.pdf'))!.contentType).toBe('application/pdf');
    expect((await readdir(join(dir, 'reports', 'weekly'))).length).toBe(5);
  });

  it('only serves report files, never other paths', async () => {
    const store = createWeeklyReportStore(dir);
    await store.write('2026-01-05', { json: '{}', csv: '' });
    expect(await store.read('weekly-2026-01-05.exe')).toBeNull();
    expect(await store.read('../../notifications.json')).toBeNull();
    expect(await store.read('weekly-1999-01-01.json')).toBeNull();
    await expect(store.write('../x', { json: '', csv: '' })).rejects.toThrow(/Invalid id/);
  });
});

describe('configStore', () => {
  it('reads data/notifications.json, or null when absent', async () => {
    expect(await createConfigStore(dir).readNotifications()).toBeNull();
    await writeFile(join(dir, 'notifications.json'), JSON.stringify({ teams: { webhookUrl: 'x' } }));
    expect(await createConfigStore(dir).readNotifications()).toEqual({ teams: { webhookUrl: 'x' } });
  });

  it('explains a broken file without echoing its contents', async () => {
    await writeFile(join(dir, 'notifications.json'), '{"telegram": {"botToken": "SECRET"');
    const err = await createConfigStore(dir).readNotifications().catch((e: Error) => e);
    expect((err as Error).message).toContain('not valid JSON');
  });
});
