import type { Request, Response, NextFunction } from "express";

export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WORKER_API_KEY;
  if (!expected) return res.status(500).json({ error: "worker_misconfigured" });
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
