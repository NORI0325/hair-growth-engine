export type ErrorType =
  | "captcha_required"
  | "login_failed"
  | "session_expired"
  | "mapping_not_found"
  | "duplicate_risk"
  | "invalid_time"
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
  // duplicate_risk は明確に「既存予約と衝突」を示す文言だけに限定する
  // （「予約を登録します。よろしいですか？」のような通常確認は除外）
  if (/重複して|同一の予約|既に予約が|予約が存在|同じ時間に予約/.test(t)) return "duplicate_risk";
  return null;
}
