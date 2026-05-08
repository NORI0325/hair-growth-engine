import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WORKER_API_KEY;
  if (!expected) return res.status(500).json({ error: "worker_misconfigured" });
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${expected}`) {
    logger.warn({
      path: req.path,
      expected_set: !!expected,
      expected_length: expected.length,
      provided_scheme: auth.split(" ")[0] || "missing",
      provided_length: auth.startsWith("Bearer ") ? auth.slice(7).length : 0,
    }, "worker bearer auth failed");
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
