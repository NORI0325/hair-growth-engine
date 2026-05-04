// LINEメッセージから 電話/メール/誕生日/氏名 を抽出するユーティリティ
import { normalizePhone } from "./line-push.ts";

export interface DetectedFields {
  phone?: string;
  email?: string;
  birthday?: string;       // YYYY-MM-DD or "----MM-DD"（年なし）
  birthdayYearKnown?: boolean;
  name?: string;
}

// 全角→半角
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\u3000]/g, " ");
}

// 誕生日抽出
// 受け付ける形式: 1990/5/12, 1990-5-12, 1990年5月12日, 5/12, 5月12日, 0512(年なし)
function detectBirthday(text: string): { value: string; yearKnown: boolean } | null {
  const t = toHalfWidth(text);

  // 年あり: YYYY[/-年]MM[/-月]DD[日]
  const m1 = t.match(/(?<![0-9])(19[0-9]{2}|20[0-9]{2})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?(?![0-9])/);
  if (m1) {
    const y = parseInt(m1[1], 10);
    const mo = parseInt(m1[2], 10);
    const d = parseInt(m1[3], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, yearKnown: true };
    }
  }

  // 年なし: M/D, M月D日
  const m2 = t.match(/(?<![0-9\/\-])(\d{1,2})[\/\-月](\d{1,2})日?(?![0-9])/);
  if (m2) {
    const mo = parseInt(m2[1], 10);
    const d = parseInt(m2[2], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      // 「12/25 18:00」のような時刻指定っぽいパターンは弾く
      const ctx = t.slice(Math.max(0, (m2.index ?? 0) - 5), (m2.index ?? 0) + (m2[0]?.length || 0) + 8);
      if (/\d:\d/.test(ctx)) return null;
      // 西暦2000年扱い（DBはdate型なのでダミー年を入れる必要がある）
      return { value: `2000-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, yearKnown: false };
    }
  }
  return null;
}

// メールアドレス抽出
function detectEmail(text: string): string | null {
  const t = toHalfWidth(text);
  const m = t.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// 電話番号抽出（normalizePhoneを再利用）
function detectPhone(text: string): string | null {
  const t = toHalfWidth(text);
  // 連続10〜11桁 or ハイフン区切り
  const m = t.match(/0\d{1,4}[\-\s]?\d{1,4}[\-\s]?\d{3,4}/);
  if (m) {
    const np = normalizePhone(m[0]);
    if (np) return np;
  }
  // 国際表記
  const m2 = t.match(/\+?81[\-\s]?\d{1,4}[\-\s]?\d{1,4}[\-\s]?\d{3,4}/);
  if (m2) {
    const np = normalizePhone(m2[0]);
    if (np) return np;
  }
  return null;
}

// 氏名候補抽出（漢字 or カタカナのみ、2〜10文字、数字や@を含まない）
function detectName(text: string, alreadyDetected: DetectedFields): string | null {
  if (alreadyDetected.email || alreadyDetected.phone) {
    // 数字・記号を除いた残りで判定
  }
  // 取り除くべきもの: 検出済みのphone/email/birthday文字列
  let residual = text;
  if (alreadyDetected.email) residual = residual.replace(alreadyDetected.email, " ");
  if (alreadyDetected.phone) {
    // 元のテキストから phone の見た目を消すのは難しいので、数字10桁以上の連続を全部消す
    residual = residual.replace(/[\d\-\s]{10,}/g, " ");
  }
  residual = toHalfWidth(residual)
    .replace(/[\d\-\/\.年月日:()@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!residual) return null;

  // 「漢字 or ひらがな or カタカナ」で2〜10文字の連続トークン
  const tokens = residual.split(/\s+/).filter(t => /^[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff\u30fc ]{2,10}$/.test(t));
  if (tokens.length === 0) return null;
  // 一番長いトークンを採用、上限20文字
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0].slice(0, 20);
}

export function detectFields(text: string): DetectedFields {
  if (!text || typeof text !== "string") return {};
  const result: DetectedFields = {};

  const phone = detectPhone(text);
  if (phone) result.phone = phone;

  const email = detectEmail(text);
  if (email) result.email = email;

  const bday = detectBirthday(text);
  if (bday) {
    result.birthday = bday.value;
    result.birthdayYearKnown = bday.yearKnown;
  }

  const name = detectName(text, result);
  if (name) result.name = name;

  return result;
}
