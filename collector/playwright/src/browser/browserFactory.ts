import type { Browser, Page } from 'playwright';

export interface LaunchOptions {
  headless: boolean;
}

export interface BrowserFactory {
  launch(options: LaunchOptions): Promise<Browser>;
}

/** playwright is imported lazily so mock-only runs don't need a Chromium install. */
export const chromiumFactory: BrowserFactory = {
  async launch({ headless }) {
    const { chromium } = await import('playwright');
    return chromium.launch({ headless });
  },
};

/** Starts the browser on first `getPage()` and tears it down in `close()`. */
export function createPageSession(factory: BrowserFactory = chromiumFactory, options: LaunchOptions = { headless: true }) {
  let browser: Browser | undefined;
  let page: Page | undefined;
  return {
    async getPage(): Promise<Page> {
      browser ??= await factory.launch(options);
      page ??= await browser.newPage({ locale: 'de-DE', viewport: { width: 1366, height: 1000 } });
      return page;
    },
    /** The page if one was opened; never launches a browser. Used to capture failure evidence. */
    peekPage(): Page | undefined {
      return page;
    },
    async close(): Promise<void> {
      await browser?.close().catch(() => undefined);
      browser = page = undefined;
    },
  };
}
export type PageSession = ReturnType<typeof createPageSession>;
