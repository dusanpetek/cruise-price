import { describe, expect, it } from 'vitest';
import { resolveCssVars, toCsv } from './exportChart';

describe('toCsv', () => {
  it('writes a header and rows, escaping commas, quotes and newlines', () => {
    expect(toCsv([{ date: '2026-01-01', note: 'a, "b"', price: 10 }, { date: '2026-01-02', note: 'x\ny', price: null }])).toBe('date,note,price\n2026-01-01,"a, ""b""",10\n2026-01-02,"x\ny",\n');
  });
  it('is empty for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('resolveCssVars', () => {
  it('inlines CSS variables so an exported SVG keeps its colours', () => {
    const vars: Record<string, string> = { '--series-1': ' #0b6aa8 ', '--border': '#ddd' };
    expect(resolveCssVars('<path stroke="var(--series-1)" fill="var(--border)"/><text fill="var(--missing)"/>', (n) => vars[n] ?? '')).toBe('<path stroke="#0b6aa8" fill="#ddd"/><text fill="currentColor"/>');
  });
});
