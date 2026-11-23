import { readFileSync } from 'node:fs';
import { AidaSelectorsSchema, MeinSchiffSelectorsSchema, type AidaSelectors, type MeinSchiffSelectors } from './schema';

export * from './schema';

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../selectors/${file}`, import.meta.url), 'utf8'));

/** Selector registries live in collector/playwright/selectors/*.json; a provider site change means editing only those. */
export const loadAidaSelectors = (): AidaSelectors => AidaSelectorsSchema.parse(read('aida.json'));
export const loadMeinSchiffSelectors = (): MeinSchiffSelectors => MeinSchiffSelectorsSchema.parse(read('mein-schiff.json'));
