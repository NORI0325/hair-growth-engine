// LINE Messaging API共通ユーティリティ
export async function sendLinePush(
  token: string,
  userId: string,
  text: string
): Promise<{ ok: boolean; status?: number; err?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, err: `LINE ${res.status}: ${body.slice(0, 300)}` };
    }
    await res.text();
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

export async function replyLine(
  token: string,
  replyToken: string,
  text: string
): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, err: `LINE reply ${res.status}: ${body.slice(0, 300)}` };
    }
    await res.text();
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "unknown" };
  }
}

// 電話番号正規化（ハイフン・全角・空白除去、+81→0変換）
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/[\u3000\s\-－ー―‐\(\)（）]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (s.startsWith("+81")) s = "0" + s.slice(3);
  if (s.startsWith("81") && s.length >= 12) s = "0" + s.slice(2);
  if (!/^\d{10,11}$/.test(s)) return null;
  return s;
}
