import type { BrowserContext, Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

const HOME_URL = "https://salonboard.com/CLP/bt/top/";
const LOGIN_URL = "https://salonboard.com/login/";
const HOME_TITLE = "SALON BOARD : TOP";
const NAV_TIMEOUT = 90000;

export interface LoginCreds {
  login_id: string | null;
  password: string | null;
}

async function snapshot(page: Page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");
  return { url, title, body };
}

function looksLikeHome(url: string, title: string, body: string): boolean {
  if (/\/CLP\/bt\/top\//i.test(url)) return true;
  if (title.includes(HOME_TITLE)) return true;
  if (body.includes("予約管理") || body.includes("スケジュール")) return true;
  return false;
}

function looksLikeLogin(url: string): boolean {
  return /\/login|\/doLogin/i.test(url);
}

/**
 * 店舗別の認証情報を受け取り、ログイン済みPageを返す。
 * /CLP/bt/top/ の domcontentloaded タイムアウトに依存せず、
 * goto の timeout を catch しても URL/title/body で実際の状態を判定する。
 */
export async function loginSalonboard(
  ctx: BrowserContext,
  creds: LoginCreds,
): Promise<{ page: Page; freshLogin: boolean }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  logger.info("checking saved salonboard session");

  try {
    // "commit" を優先（型が無い環境のフォールバック付き）
    await page.goto(HOME_URL, { waitUntil: "commit" as any, timeout: NAV_TIMEOUT });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "top goto timeout but continuing");
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
    } catch { /* ignore */ }
  }

  let snap = await snapshot(page);
  logger.info(`currentUrl: ${snap.url}`);
  logger.info(`title: ${snap.title}`);
  logger.info(`body snippet: ${snap.body.substring(0, 500)}`);

  if (looksLikeHome(snap.url, snap.title, snap.body)) {
    logger.info("salonboard saved session ok");
    return { page, freshLogin: false };
  }

  // captcha検出
  if (/画像認証|captcha/i.test(snap.body)) {
    throw new WorkerError("captcha_required", "captcha shown on top page");
  }

  // ログインフォームが見えていない & ログインURLでもない場合は明示的に /login/ へ
  const hasUserField = (await page.locator('input[name="userId"]').count().catch(() => 0)) > 0;
  if (!hasUserField && !looksLikeLogin(snap.url)) {
    try {
      await page.goto(LOGIN_URL, { waitUntil: "commit" as any, timeout: NAV_TIMEOUT });
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "login goto timeout but continuing");
    }
    snap = await snapshot(page);
    logger.info(`currentUrl: ${snap.url}`);
    logger.info(`title: ${snap.title}`);
  }

  const userCount = await page.locator('input[name="userId"]').count().catch(() => 0);
  const passCount = await page.locator('input[name="password"]').count().catch(() => 0);
  const isLoginPage = userCount > 0 || passCount > 0 || looksLikeLogin(snap.url);
  if (!isLoginPage) {
    throw new WorkerError("login_failed", `unexpected page url=${snap.url} title=${snap.title}`);
  }

  if (!creds.login_id || !creds.password) {
    throw new WorkerError("login_failed", "credentials not provided for this store");
  }

  await page.locator('input[name="userId"]').fill(creds.login_id);
  await page.locator('input[name="password"]').fill(creds.password);

  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {}),
      page.locator("a.common-CNCcommon__primaryBtn.loginBtnSize, input[type=submit], button[type=submit]").first().click(),
    ]);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "login submit nav warning");
  }

  snap = await snapshot(page);
  logger.info(`currentUrl: ${snap.url}`);
  logger.info(`title: ${snap.title}`);

  if (looksLikeLogin(snap.url)) {
    if (/画像認証|captcha/i.test(snap.body)) {
      throw new WorkerError("captcha_required", "captcha required after submit");
    }
    throw new WorkerError("login_failed", "still on login page after submit");
  }

  logger.info("salonboard fresh login ok");
  return { page, freshLogin: true };
}
