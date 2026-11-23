import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AlertRuleInputSchema,
  AlertRuleSchema,
  AlertSchema,
  type Alert,
  type AlertRule,
  type AlertRuleInput,
} from '@cruise/domain';
import { newId } from '../index';
import { NotFoundError } from './errors';
import { assertSafeId, readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

async function readAll<T>(dir: string, parse: (raw: unknown) => T | null): Promise<T[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    const parsed = parse(await readJson(join(dir, f)).catch(() => null));
    if (parsed) out.push(parsed);
  }
  return out;
}

const DEFAULT_RULES: AlertRuleInput[] = [
  { type: 'NEW_LOW' },
  { type: 'PERCENT_DROP', percent: 10 },
];

/** data/alert-rules/<id>.json: what to alert on. */
export function createAlertRuleStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'alert-rules');
  const marker = join(dir, '.initialized');
  const fileOf = (id: string) => join(dir, `${assertSafeId(id)}.json`);

  const store = {
    async list(): Promise<AlertRule[]> {
      const rules = await readAll(dir, (raw) => {
        const r = AlertRuleSchema.safeParse(raw);
        return r.success ? r.data : null;
      });
      // Rules created in the same millisecond (the defaults) must still list in a stable order.
      return rules.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
    },

    async create(input: AlertRuleInput): Promise<AlertRule> {
      const rule: AlertRule = { ...AlertRuleInputSchema.parse(input), id: newId(), createdAt: new Date().toISOString() };
      await writeJsonAtomic(fileOf(rule.id), rule);
      return rule;
    },

    async remove(id: string): Promise<void> {
      const rules = await store.list();
      if (!rules.some((r) => r.id === id)) throw new NotFoundError(`Alert rule ${id}`);
      await rm(fileOf(id));
    },

    /** Creates "new historical low" and "10% drop" rules for all routes, once. Deleting them later sticks. */
    async ensureDefaults(): Promise<void> {
      if (await readdir(dir).then((files) => files.includes('.initialized'), () => false)) return;
      await mkdir(dir, { recursive: true });
      if ((await store.list()).length === 0) for (const input of DEFAULT_RULES) await store.create(input);
      await writeFile(marker, new Date().toISOString());
    },
  };
  return store;
}
export type AlertRuleStore = ReturnType<typeof createAlertRuleStore>;

export interface AlertFilter {
  provider?: string;
  type?: string;
  /** ISO timestamp: only alerts created at or after it. */
  since?: string;
}

/** data/alerts/<id>.json: alerts raised by collections; status and delivery results are updated in place. */
export function createAlertStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'alerts');
  const fileOf = (id: string) => join(dir, `${assertSafeId(id)}.json`);

  const store = {
    async create(input: Omit<Alert, 'id' | 'createdAt' | 'status' | 'deliveries' | 'cruisePrice' | 'flightPrice' | 'totalPrice'> & Partial<Pick<Alert, 'createdAt' | 'cruisePrice' | 'flightPrice' | 'totalPrice'>>): Promise<Alert> {
      const alert = AlertSchema.parse({ ...input, id: newId(), createdAt: input.createdAt ?? new Date().toISOString(), status: 'new', deliveries: [] });
      await writeJsonAtomic(fileOf(alert.id), alert);
      return alert;
    },

    async get(id: string): Promise<Alert> {
      try {
        return AlertSchema.parse(await readJson(fileOf(id)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`Alert ${id}`);
        throw e;
      }
    },

    /** Newest first. */
    async list(filter: AlertFilter = {}, limit = 500): Promise<Alert[]> {
      const alerts = await readAll(dir, (raw) => {
        const r = AlertSchema.safeParse(raw);
        return r.success ? r.data : null;
      });
      return alerts
        .filter((a) => (!filter.provider || a.provider === filter.provider) && (!filter.type || a.type === filter.type) && (!filter.since || a.createdAt >= filter.since))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },

    async setDeliveries(id: string, deliveries: Alert['deliveries']): Promise<Alert> {
      const next = AlertSchema.parse({ ...(await store.get(id)), deliveries });
      await writeJsonAtomic(fileOf(id), next);
      return next;
    },

    async acknowledge(id: string): Promise<Alert> {
      const next = AlertSchema.parse({ ...(await store.get(id)), status: 'acknowledged' });
      await writeJsonAtomic(fileOf(id), next);
      return next;
    },
  };
  return store;
}
export type AlertStore = ReturnType<typeof createAlertStore>;
