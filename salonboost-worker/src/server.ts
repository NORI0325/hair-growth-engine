import "dotenv/config";
import express from "express";
import { z } from "zod";
import { bearerAuth } from "./auth.js";
import { withContext, shutdownBrowser } from "./browser.js";
import { loginSalonboard } from "./salonboard/login.js";
import { createReservation } from "./salonboard/createReservation.js";
import { updateReservation } from "./salonboard/updateReservation.js";
import { cancelReservation } from "./salonboard/cancelReservation.js";
import { WorkerError } from "./errorMapper.js";
import { postCallback } from "./callback.js";
import { logger } from "./logger.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const JobSchema = z.object({
  job_id: z.string(),
  store_id: z.string().optional(),
  location_id: z.string().nullable().optional(),
  reservation_id: z.string().nullable().optional(),
  target_channel: z.literal("salonboard"),
  job_type: z.enum(["create", "update", "cancel"]),
  reservation: z.record(z.any()),
  async_callback: z.boolean().optional(),
});

app.post("/api/sync-job", bearerAuth, async (req, res) => {
  const parsed = JobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error_type: "unknown_error", message: "invalid_body", details: parsed.error.flatten() });
  }
  const job = parsed.data;
  logger.info({ job_id: job.job_id, type: job.job_type, dry_run: (job.reservation as any)?.dry_run === true }, "job received");

  // dry-run モード：サロンボードに一切触らず疎通だけ確認
  if ((job.reservation as any)?.dry_run === true) {
    logger.info({ job_id: job.job_id }, "dry_run: skipping salonboard");
    return res.json({
      success: true,
      dry_run: true,
      external_reservation_id: null,
      message: "dry_run ok - no salonboard action performed",
    });
  }

  // 非同期モード（async_callback=true）なら即200を返してバックグラウンド実行
  if (job.async_callback) {
    res.status(202).json({ accepted: true });
    runJob(job).catch((e) => logger.error({ e }, "async job error"));
    return;
  }

  // 同期モード
  try {
    const result = await runJob(job);
    res.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof WorkerError) {
      res.json({ success: false, error_type: e.errorType, message: e.message });
    } else {
      logger.error({ err: e }, "job failed");
      res.json({ success: false, error_type: "unknown_error", message: e instanceof Error ? e.message : String(e) });
    }
  }
});

async function runJob(job: z.infer<typeof JobSchema>) {
  let result: { external_reservation_id?: string | null } = {};
  try {
    result = await withContext(async (ctx) => {
      const page = await loginSalonboard(ctx);
      switch (job.job_type) {
        case "create":  return await createReservation(page, job.reservation as any);
        case "update":  return await updateReservation(page, job.reservation as any);
        case "cancel":  return await cancelReservation(page, job.reservation as any);
      }
    });
    if (job.async_callback) {
      await postCallback({ job_id: job.job_id, success: true, external_reservation_id: result.external_reservation_id ?? null });
    }
    return result;
  } catch (e) {
    const errorType = e instanceof WorkerError ? e.errorType : "unknown_error";
    const message = e instanceof Error ? e.message : String(e);
    if (job.async_callback) {
      await postCallback({ job_id: job.job_id, success: false, error_type: errorType, message });
    }
    throw e;
  }
}

const PORT = Number(process.env.PORT ?? 8080);
const server = app.listen(PORT, () => logger.info({ PORT }, "salonboost-worker listening"));

async function shutdown() {
  logger.info("shutting down");
  server.close();
  await shutdownBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
