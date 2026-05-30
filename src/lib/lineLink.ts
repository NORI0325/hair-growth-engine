export const normalizeLineOfficialAccountId = (value?: string | null): string | null => {
  const raw = (value || "").trim();
  if (!raw) return null;

  const fromUrl = raw.match(/line\.me\/R\/(?:oaMessage|ti\/p)\/([^/?#]+)/i);
  const candidate = fromUrl ? decodeURIComponent(fromUrl[1]) : raw;
  const withAt = candidate.startsWith("@") ? candidate : `@${candidate}`;

  return /^@[A-Za-z0-9._-]{3,40}$/.test(withAt) ? withAt : null;
};

export const buildLineOaMessageUrl = (
  officialAccountId: string | null | undefined,
  message: string
): string | null => {
  const normalized = normalizeLineOfficialAccountId(officialAccountId);
  if (!normalized || !message.trim()) return null;

  return `https://line.me/R/oaMessage/${encodeURIComponent(normalized)}/?${encodeURIComponent(message)}`;
};
