const isProduction = process.env.NODE_ENV === "production";

export function assertWorkerConfiguration(): void {
  const errors: string[] = [];
  const workerApiKey = process.env.WORKER_API_KEY?.trim() ?? "";
  const callbackUrl = process.env.CALLBACK_URL?.trim() ?? "";
  const allowFallback = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK === "true";

  if (workerApiKey.length < 24) errors.push("WORKER_API_KEY must be set to a strong value");
  if (callbackUrl && !/^https:\/\/[^/]+\/functions\/v1\/sync-worker-callback\/?$/i.test(callbackUrl)) {
    errors.push("CALLBACK_URL must be an HTTPS sync-worker-callback URL");
  }
  if (isProduction && !callbackUrl && !allowFallback) {
    errors.push("CALLBACK_URL is required in production unless ALLOW_ENV_CREDENTIAL_FALLBACK=true");
  }
  if (!callbackUrl && allowFallback) {
    if (!process.env.SALONBOARD_USER_ID || !process.env.SALONBOARD_PASSWORD) {
      errors.push("fallback credentials are incomplete");
    }
  }

  if (errors.length > 0) throw new Error(`Worker configuration invalid: ${errors.join("; ")}`);
}

export const allowEnvironmentCredentialFallback = (): boolean =>
  process.env.ALLOW_ENV_CREDENTIAL_FALLBACK === "true";
