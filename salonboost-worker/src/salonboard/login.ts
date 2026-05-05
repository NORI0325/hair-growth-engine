import type { BrowserContext, Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

const LOGIN_URL = "https://salonboard.com/login/";

/**
 * サロンボードにログインし、ログイン済みPageを返す。
 * ログイン情報は環境変数 SALONBOARD_USER_ID / SALONBOARD_PASSWORD から取得。
 */
export async function loginSalonboard(ctx: BrowserContext): Promise<Page> {
  const userId = process.env.SALONBOARD_USER_ID;
  const password = process.env.SALONBOARD_PASSWORD;
  if (!userId || !password) {
    throw new WorkerError("login_failed", "SALONBOARD credentials not configured");
  }

  const page = await ctx.newPage();
  page.setDefaultTimeout(Number(process.env.NAV_TIMEOUT_MS ?? 30000));

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // 画像認証チェック
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/画像認証|captcha/i.test(bodyText)) {
    throw new WorkerError("captcha_required", "captcha shown on login page");
  }

  await page.locator('input[name="userId"]').fill(userId);
  await page.locator('input[name="password"]').fill(password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('a.common-CNCcommon__primaryBtn.loginBtnSize').click(),
  ]);

  // ログイン後URLチェック
  const url = page.url();
  if (/\/login/i.test(url)) {
    const txt = await page.locator("body").innerText().catch(() => "");
    if (/画像認証|captcha/i.test(txt)) {
      throw new WorkerError("captcha_required", "captcha required after submit");
    }
    throw new WorkerError("login_failed", "still on login page after submit");
  }

  logger.info({ url }, "salonboard login ok");
  return page;
}
