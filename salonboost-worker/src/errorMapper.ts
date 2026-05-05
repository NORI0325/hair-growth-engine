export type ErrorType =
  | "captcha_required"
  | "login_failed"
  | "session_expired"
  | "mapping_not_found"
  | "duplicate_risk"
  | "external_site_changed"
  | "network_error"
  | "unknown_error";

export class WorkerError extends Error {
  constructor(public errorType: ErrorType, message: string) {
    super(message);
  }
}

/**
 * ページ内テキストやURLからerror_typeを推定
 */
export function detectErrorFromPage(opts: { url: string; bodyText: string }): ErrorType | null {
  const t = opts.bodyText;
  if (/画像認証|キャプチャ|captcha|reCAPTCHA/i.test(t)) return "captcha_required";
  if (/ID.*パスワード.*正しく|ログインできません|認証に失敗/.test(t)) return "login_failed";
  if (/セッションが切れ|再度ログイン|ログイン画面/.test(t) || /\/login/i.test(opts.url)) {
    return "session_expired";
  }
  if (/重複|既に予約|同じ時間に/.test(t)) return "duplicate_risk";
  return null;
}
