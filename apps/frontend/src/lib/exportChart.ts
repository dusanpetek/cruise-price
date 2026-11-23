import { t } from './i18n';

export type Row = Record<string, string | number | null>;

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows to CSV, with the columns of the first row. */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]!);
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? null)).join(','))].join('\n') + '\n';
}

/** Replaces `var(--name)` with the current computed value, so a serialized SVG keeps its colours outside the page. */
export function resolveCssVars(svg: string, read: (name: string) => string): string {
  return svg.replace(/var\((--[\w-]+)\)/g, (_m, name: string) => read(name).trim() || 'currentColor');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportCsv(rows: Row[], filename: string) {
  download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

/** Draws the chart's SVG onto a canvas (2x) with the card background and downloads it as a PNG. */
export async function exportPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const styles = getComputedStyle(document.documentElement);
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const markup = resolveCssVars(new XMLSerializer().serializeToString(clone), (n) => styles.getPropertyValue(n));
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(t('Could not render the chart')));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const canvas = Object.assign(document.createElement('canvas'), { width: width * 2, height: height * 2 });
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.fillStyle = styles.getPropertyValue('--card').trim() || '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  await new Promise<void>((resolve) => canvas.toBlob((b) => (b && download(b, `${filename}.png`), resolve())));
}
