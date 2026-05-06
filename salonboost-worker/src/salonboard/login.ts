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

function isSessionExpired(title: string, body: string): boolean {
  if (title.includes("SALON BOARD : エラー")) return true;
  if (
    body.includes("一定時間操作されなかった") ||
    body.includes("ログインの有効期限が切れました") ||
    body.includes("再度ログインしなおしてください")
  ) return true;
  return false;
}

function isCaptcha(body: string): boolean {
  return /画像認証|captcha|reCAPTCHA/i.test(body);
}

function looksLikeHome(url: string, title: string, body: string): boolean {
  // タイトルがTOPか、本文にTOP固有の文言があれば成功
  if (title.includes(HOME_TITLE)) return true;
  if (body.includes("予約管理") || body.includes("スケジュール")) return true;
  // URLだけでは判定しない（エラーページでも /CLP/bt/top/ になることがあるため）
  return false;
}

function looksLikeLogin(url: string): boolean {
  return /\/login|\/doLogin/i.test(url);
}

async function gotoSafe(page: Page, url: string, label: string) {
  try {
    await page.goto(url, { waitUntil: "commit" as any, timeout: NAV_TIMEOUT });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, `${label} goto timeout but continuing`);
  }
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
  } catch { /* ignore */ }
}

async function performLogin(page: Page, creds: LoginCreds) {
  if (!creds.login_id || !creds.password) {
    throw new WorkerError("login_failed", "credentials not provided for this store");
  }
  await page.locator('input[name="userId"]').fill(creds.login_id);
  await page.locator('input[name="password"]').fill(creds.password);
  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {}),
      page
        .locator("a.common-CNCcommon__primaryBtn.loginBtnSize, input[type=submit], button[type=submit]")
        .first()
        .click(),
    ]);
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "login submit nav warning");
  }
}

export async function loginSalonboard(
  ctx: BrowserContext,
  creds: LoginCreds,
): Promise<{ page: Page; freshLogin: boolean }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  logger.info("checking saved salonboard session");
  await gotoSafe(page, HOME_URL, "top");

  let snap = await snapshot(page);
  logger.info(`currentUrl: ${snap.url}`);
  logger.info(`title: ${snap.title}`);
  logger.info(`body snippet: ${snap.body.substring(0, 500)}`);

  if (isCaptcha(snap.body)) {
    logger.warn("captcha_required");
    throw new WorkerError("captcha_required", "captcha shown on top page");
  }

  // セッション期限切れページの判定（URLだけで判定しない）
  const expired = isSessionExpired(snap.title, snap.body);
  if (!expired && looksLikeHome(snap.url, snap.title, snap.body)) {
    logger.info("salonboard saved session ok");
    return { page, freshLogin: false };
  }

  if (expired) {
    logger.info("session expired page detected");
  }

  logger.info("trying fresh login");

  // 「ログインへ」リンクがあればクリック、なければ /login/ へ遷移
  const loginLink = page.locator('a:has-text("ログインへ")').first();
  const hasLoginLink = (await loginLink.count().catch(() => 0)) > 0;
  if (hasLoginLink) {
    try {
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {}),
        loginLink.click(),
      ]);
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "login link click warning");
    }
  }

  snap = await snapshot(page);
  const userCount = await page.locator('input[name="userId"]').count().catch(() => 0);
  if (userCount === 0 && !looksLikeLogin(snap.url)) {
    await gotoSafe(page, LOGIN_URL, "login");
    snap = await snapshot(page);
  }

  logger.info(`currentUrl: ${snap.url}`);
  logger.info(`title: ${snap.title}`);

  if (isCaptcha(snap.body)) {
    logger.warn("captcha_required");
    throw new WorkerError("captcha_required", "captcha shown on login page");
  }

  await performLogin(page, creds);

  snap = await snapshot(page);
  logger.info(`currentUrl: ${snap.url}`);
  logger.info(`title: ${snap.title}`);
  logger.info(`body snippet: ${snap.body.substring(0, 500)}`);

  if (isCaptcha(snap.body)) {
    logger.warn("captcha_required");
    throw new WorkerError("captcha_required", "captcha required after submit");
  }

  if (looksLikeLogin(snap.url)) {
    logger.warn("login_failed");
    throw new WorkerError("login_failed", "still on login page after submit");
  }

  if (isSessionExpired(snap.title, snap.body)) {
    logger.warn("login_failed");
    throw new WorkerError("login_failed", "session expired page after login");
  }

  // TOP画面到達確認のためHOMEへ
  if (!looksLikeHome(snap.url, snap.title, snap.body)) {
    await gotoSafe(page, HOME_URL, "top-after-login");
    snap = await snapshot(page);
    logger.info(`currentUrl: ${snap.url}`);
    logger.info(`title: ${snap.title}`);
  }

  if (isSessionExpired(snap.title, snap.body) || !looksLikeHome(snap.url, snap.title, snap.body)) {
    logger.warn("login_failed");
    throw new WorkerError("login_failed", `unexpected page after login url=${snap.url} title=${snap.title}`);
  }

  logger.info("salonboard fresh login ok");
  return { page, freshLogin: true };
}
