import { logger } from "./logger.js";

export async function postCallback(payload: {
  job_id: string;
  success: boolean;
  external_reservation_id?: string | null;
  error_type?: string;
  message?: string;
}) {
  const url = process.env.CALLBACK_URL;
  const key = process.env.WORKER_API_KEY;
  if (!url || !key) {
    logger.warn("CALLBACK_URL or WORKER_API_KEY not set; skip callback");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "callback failed");
    }
  } catch (e) {
    logger.error({ err: e }, "callback fetch error");
  }
}
