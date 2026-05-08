import "dotenv/config";
import express from "express";
import { z } from "zod";
import { bearerAuth } from "./auth.js";
import { withContext, shutdownBrowser } from "./browser.js";
import { loginSalonboard } from "./salonboard/login.js";
import { createReservation } from "./salonboard/createReservation.js";
import { updateReservation } from "./salonboard/updateReservation.js";
import { cancelReservation } from "./salonboard/cancelReservation.js";
import { fetchSalonboardStaff } from "./salonboard/fetchStaff.js";
import { fetchSalonboardMenus } from "./salonboard/fetchMenus.js";
import { WorkerError } from "./errorMapper.js";
import { postCallback } from "./callback.js";
import { fetchSession, saveSession } from "./sessionStore.js";
import { logger } from "./logger.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const JobSchema = z.object({
  job_id: z.string(),
  store_id: z.string().min(1),                 // = owner_id
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
  logger.info({ job_id: job.job_id, owner: job.store_id, location: job.location_id, type: job.job_type }, "job received");

  if ((job.reservation as any)?.dry_run === true) {
    return res.json({ success: true, dry_run: true, external_reservation_id: null, message: "dry_run ok" });
  }

  if (job.async_callback) {
    res.status(202).json({ accepted: true });
    runJob(job).catch((e) => logger.error({ e }, "async job error"));
    return;
  }

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

// ===== 初期設定用：サロンボード側スタッフ・メニュー一覧取得 =====
const FetchSchema = z.object({
  store_id: z.string().min(1),
  location_id: z.string().nullable().optional(),
});

async function withSalonboardSession<T>(
  storeId: string, locationId: string | null,
  run: (page: import("playwright").Page) => Promise<T>,
): Promise<T> {
  const creds = await fetchSession(storeId, locationId).catch((e) => {
    throw new WorkerError("login_failed", `session fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  return await withContext({ storageState: creds.storage_state }, async (ctx) => {
    const { page, freshLogin } = await loginSalonboard(ctx, { login_id: creds.login_id, password: creds.password });
    if (freshLogin) {
      try {
        const state = await ctx.storageState();
        await saveSession(storeId, locationId, state, "ok");
      } catch (e) { logger.warn({ e }, "saveSession failed"); }
    }
    return await run(page);
  });
}

app.post("/api/salonboard/fetch-staff", bearerAuth, async (req, res) => {
  const parsed = FetchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error_type: "unknown_error", message: "invalid_body" });
  logger.info({ owner: parsed.data.store_id, location: parsed.data.location_id ?? null, type: "fetch_staff" }, "job received");
  try {
    const staff = await withSalonboardSession(parsed.data.store_id, parsed.data.location_id ?? null, fetchSalonboardStaff);
    res.json({ success: true, staff });
  } catch (e) {
    if (e instanceof WorkerError) res.json({ success: false, error_type: e.errorType, message: e.message });
    else { logger.error({ err: e }, "fetch-staff failed"); res.json({ success: false, error_type: "unknown_error", message: e instanceof Error ? e.message : String(e) }); }
  }
});

app.post("/api/salonboard/fetch-menus", bearerAuth, async (req, res) => {
  const parsed = FetchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error_type: "unknown_error", message: "invalid_body" });
  logger.info({ owner: parsed.data.store_id, location: parsed.data.location_id ?? null, type: "fetch_menus" }, "job received");
  try {
    const menus = await withSalonboardSession(parsed.data.store_id, parsed.data.location_id ?? null, fetchSalonboardMenus);
    res.json({ success: true, menus });
  } catch (e) {
    if (e instanceof WorkerError) res.json({ success: false, error_type: e.errorType, message: e.message });
    else { logger.error({ err: e }, "fetch-menus failed"); res.json({ success: false, error_type: "unknown_error", message: e instanceof Error ? e.message : String(e) }); }
  }
});

async function runJob(job: z.infer<typeof JobSchema>) {
  // 店舗別の認証情報・保存セッションを取得
  const creds = await fetchSession(job.store_id, job.location_id ?? null).catch((e) => {
    throw new WorkerError("login_failed", `session fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  let result: { external_reservation_id?: string | null } = {};
  try {
    result = await withContext({ storageState: creds.storage_state }, async (ctx) => {
      const { page, freshLogin } = await loginSalonboard(ctx, { login_id: creds.login_id, password: creds.password });

      // freshLoginならstorageStateを保存
      if (freshLogin) {
        try {
          const state = await ctx.storageState();
          await saveSession(job.store_id, job.location_id ?? null, state, "ok");
        } catch (e) { logger.warn({ e }, "saveSession failed"); }
      }

      switch (job.job_type) {
        case "create": return await createReservation(page, job.reservation as any);
        case "update": return await updateReservation(page, job.reservation as any);
        case "cancel": return await cancelReservation(page, job.reservation as any);
      }
    });
    if (job.async_callback) {
      await postCallback({ job_id: job.job_id, success: true, external_reservation_id: result.external_reservation_id ?? null });
    }
    return result;
  } catch (e) {
    const errorType = e instanceof WorkerError ? e.errorType : "unknown_error";
    const message = e instanceof Error ? e.message : String(e);
    // 認証起因なら保存セッションを invalidate
    if (errorType === "login_failed" || errorType === "captcha_required") {
      await saveSession(job.store_id, job.location_id ?? null, null, "invalid", message).catch(() => {});
    }
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
