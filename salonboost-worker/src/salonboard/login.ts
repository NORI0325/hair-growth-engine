import type { BrowserContext, Page } from "playwright";
import { WorkerError } from "../errorMapper.js";
import { logger } from "../logger.js";

const LOGIN_URL = "https://salonboard.com/login/";
const HOME_URL_RE = /salonboard\.com\/(KLP|CNK|CLP|CNS|XX)/i;

export interface LoginCreds {
  login_id: string | null;
  password: string | null;
}

/**
 * 店舗別の認証情報を受け取り、ログイン済みPageを返す。
 * 既存ctxにstorageStateが流し込まれていれば、まずホーム遷移で有効性を判定し、
 * 無効ならID/PWでログインする。
 */
export async function loginSalonboard(ctx: BrowserContext, creds: LoginCreds): Promise<{ page: Page; freshLogin: boolean }> {
  const page = await ctx.newPage();
  page.setDefaultTimeout(Number(process.env.NAV_TIMEOUT_MS ?? 30000));

  // storageStateが効いていればログインページに飛ばずに済む
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  if (HOME_URL_RE.test(page.url())) {
    logger.info({ url: page.url() }, "salonboard session reused");
    return { page, freshLogin: false };
  }

  if (!creds.login_id || !creds.password) {
    throw new WorkerError("login_failed", "credentials not provided for this store");
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/画像認証|captcha/i.test(bodyText)) {
    throw new WorkerError("captcha_required", "captcha shown on login page");
  }

  await page.locator('input[name="userId"]').fill(creds.login_id);
  await page.locator('input[name="password"]').fill(creds.password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('a.common-CNCcommon__primaryBtn.loginBtnSize').click(),
  ]);

  const url = page.url();
  if (/\/login/i.test(url)) {
    const txt = await page.locator("body").innerText().catch(() => "");
    if (/画像認証|captcha/i.test(txt)) {
      throw new WorkerError("captcha_required", "captcha required after submit");
    }
    throw new WorkerError("login_failed", "still on login page after submit");
  }

  logger.info({ url }, "salonboard fresh login ok");
  return { page, freshLogin: true };
}
