import type { BrowserContext, Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

const HOME_URL = "https://salonboard.com/CLP/bt/top/";
const LOGIN_URL = "https://salonboard.com/login/";
const HOME_TITLE = "SALON BOARD : TOP";
const HOME_URL_RE = /salonboard\.com\/(KLP|CNK|CLP|CNS|XX)/i;
const NAV_TIMEOUT = 90000;

export interface LoginCreds {
  login_id: string | null;
  password: string | null;
}

/**
 * 店舗別の認証情報を受け取り、ログイン済みPageを返す。
 * まず /CLP/bt/top/ を開いて保存済みセッションの有効性を確認。
 * ログイン画面にリダイレクトされた場合のみID/PWでログインする。
 */
export async function loginSalonboard(
  ctx: BrowserContext,
  creds: LoginCreds,
): Promise<{ page: Page; freshLogin: boolean }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  logger.info("checking saved salonboard session");
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

  let url = page.url();
  let title = await page.title().catch(() => "");
  logger.info({ url }, `url: ${url}`);
  logger.info({ title }, `title: ${title}`);

  if (title === HOME_TITLE || /\/CLP\/bt\/top\//i.test(url) || HOME_URL_RE.test(url)) {
    logger.info("salonboard saved session ok");
    return { page, freshLogin: false };
  }

  // ログイン画面に飛ばされた場合のみID/PWで再ログイン
  if (!creds.login_id || !creds.password) {
    throw new WorkerError("login_failed", "credentials not provided for this store");
  }

  // captcha検出
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/画像認証|captcha/i.test(bodyText)) {
    throw new WorkerError("captcha_required", "captcha shown on login page");
  }

  // 既にログインフォームが見えていなければ /login/ に明示的に遷移
  const hasUserField = await page.locator('input[name="userId"]').count().catch(() => 0);
  if (!hasUserField) {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  }

  await page.locator('input[name="userId"]').fill(creds.login_id);
  await page.locator('input[name="password"]').fill(creds.password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator("a.common-CNCcommon__primaryBtn.loginBtnSize").click(),
  ]);

  url = page.url();
  title = await page.title().catch(() => "");
  logger.info({ url }, `url: ${url}`);
  logger.info({ title }, `title: ${title}`);

  if (/\/login/i.test(url)) {
    const txt = await page.locator("body").innerText().catch(() => "");
    if (/画像認証|captcha/i.test(txt)) {
      throw new WorkerError("captcha_required", "captcha required after submit");
    }
    throw new WorkerError("login_failed", "still on login page after submit");
  }

  logger.info("salonboard fresh login ok");
  return { page, freshLogin: true };
}
