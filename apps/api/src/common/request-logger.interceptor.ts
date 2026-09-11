import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { tap } from "rxjs";
import type { RequestWithUserId } from "../auth/jwt-auth.guard";

/** One structured line per request (spec §77 logging ask) - JSON in
 * production so it's machine-parseable by whatever log aggregator a real
 * deployment points at, a plain readable line in dev. Deliberately doesn't
 * log request/response bodies - those routinely carry document titles,
 * customer names, and (on the SMTP/AD config endpoints) secrets in transit,
 * and the AuditLog already captures the who/what/when that matters for
 * business events. This is operational request timing/error visibility,
 * not a second audit trail. */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");
  private readonly json = process.env.NODE_ENV === "production";

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<RequestWithUserId>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res.statusCode, start),
        error: (err: unknown) => this.log(req, (err as { status?: number })?.status ?? 500, start),
      }),
    );
  }

  private log(req: RequestWithUserId, statusCode: number, start: number) {
    const durationMs = Date.now() - start;
    const entry = {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      durationMs,
      userId: req.userId ?? null,
      ip: req.ip,
    };
    if (this.json) {
      this.logger.log(JSON.stringify(entry));
    } else {
      this.logger.log(`${entry.method} ${entry.path} ${entry.statusCode} ${entry.durationMs}ms${entry.userId ? ` user=${entry.userId}` : ""}`);
    }
  }
}
