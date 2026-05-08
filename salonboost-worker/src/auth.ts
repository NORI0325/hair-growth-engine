import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { logger } from "./logger.js";

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WORKER_API_KEY;
  if (!expected) {
    logger.error({ path: req.path, reason: "WORKER_API_KEY_missing" }, "worker bearer auth failed");
    return res.status(500).json({ error: "worker_misconfigured" });
  }
  const auth = req.headers.authorization ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (auth !== `Bearer ${expected}`) {
    const reason = !auth
      ? "missing_authorization_header"
      : !auth.startsWith("Bearer ")
        ? "invalid_authorization_scheme"
        : "bearer_token_mismatch";
    logger.warn({
      path: req.path,
      reason,
      expected_set: !!expected,
      expected_length: expected.length,
      provided_scheme: auth.split(" ")[0] || "missing",
      provided_length: provided.length,
      expected_key_fingerprint_prefix: fingerprint(expected),
      provided_key_fingerprint_prefix: provided ? fingerprint(provided) : null,
    }, "worker bearer auth failed");
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
