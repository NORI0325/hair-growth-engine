export type SalonboardKeyDiagnostic = {
  key_present: boolean;
  key_length_after_base64_decode: number;
};

const KEY_NAME = "SALONBOARD_ENCRYPTION_KEY";

function decodeBase64(raw: string): Uint8Array {
  return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

export function getSalonboardKeyDiagnostic(): SalonboardKeyDiagnostic {
  const raw = Deno.env.get(KEY_NAME);
  if (!raw) return { key_present: false, key_length_after_base64_decode: 0 };
  try {
    return { key_present: true, key_length_after_base64_decode: decodeBase64(raw).length };
  } catch {
    return { key_present: true, key_length_after_base64_decode: 0 };
  }
}

async function getSalonboardKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get(KEY_NAME);
  if (!raw) return null;
  try {
    const bytes = decodeBase64(raw);
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

export async function encryptSalonboardText(plain: string | null): Promise<string | null> {
  if (plain == null) return null;
  const key = await getSalonboardKey();
  if (!key) throw new Error("invalid_salonboard_encryption_key");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const merged = new Uint8Array(iv.length + enc.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(enc), iv.length);
  return encodeBase64(merged);
}

export async function decryptSalonboardText(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  const key = await getSalonboardKey();
  if (!key) return null;
  try {
    const buf = decodeBase64(payload);
    const iv = buf.slice(0, 12);
    const data = buf.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}