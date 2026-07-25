import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type SafeFields = Record<string, string | number | boolean | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: SafeFields = {}): void {
  // Structured logs intentionally never receive request bodies, headers, keys, or prompts.
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}

export const logInfo = (event: string, fields?: SafeFields): void => emit("info", event, fields);
export const logWarn = (event: string, fields?: SafeFields): void => emit("warn", event, fields);
export const logError = (event: string, fields?: SafeFields): void => emit("error", event, fields);

export function apiRequestLogger(request: Request, response: Response, next: NextFunction): void {
  if (!request.path.startsWith("/api")) return next();
  const requestId = randomUUID().slice(0, 12);
  const started = performance.now();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const status = response.statusCode;
    emit(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "api.request", {
      requestId,
      method: request.method,
      path: request.path,
      status,
      durationMs: Math.round(performance.now() - started),
    });
  });
  next();
}
