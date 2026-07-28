import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password", "login_id", "authorization", "apiKey", "storage_state",
      "customerName", "phone", "email", "body", "bodySnippet", "snippet", "chosenText",
      "text", "raw", "candidate_snippet", "items", "candidates", "input", "reservation", "request_payload",
      "req.headers.authorization", "headers.authorization",
      "*.password", "*.login_id", "*.authorization", "*.apiKey", "*.storage_state",
      "*.customerName", "*.phone", "*.email", "*.body", "*.bodySnippet", "*.snippet",
      "*.text", "*.raw", "*.candidate_snippet", "*.items", "*.candidates", "*.reservation",
      "*.request_payload",
    ],
    censor: "[REDACTED]",
  },
  transport: process.env.NODE_ENV === "production"
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});
