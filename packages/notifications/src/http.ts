import { ChannelError, type FetchFn } from './types';

const TIMEOUT_MS = 10_000;

/**
 * POSTs and turns the outcome into a ChannelError that says whether retrying is worthwhile.
 * Messages never include the URL: Telegram tokens and webhook URLs are secrets.
 */
export async function post(fetchFn: FetchFn, url: string, init: { headers?: Record<string, string>; body: string }, what: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: init.headers, body: init.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ChannelError(`${what}: network error (${(e as Error).name})`, true);
  }
  if (res.ok) return;
  throw new ChannelError(`${what}: HTTP ${res.status}`, res.status >= 500 || res.status === 429);
}
