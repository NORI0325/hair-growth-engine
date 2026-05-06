import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "./logger.js";

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      channel: "chrome",
      headless: process.env.HEADLESS !== "false",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return browserPromise;
}

export interface ContextOptions {
  storageState?: any | null;
}

export async function withContext<T>(opts: ContextOptions, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch((e) => logger.warn({ e }, "context close failed"));
  }
}

export async function shutdownBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close().catch(() => {});
    browserPromise = null;
  }
}
