import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";

/** Converts Prisma's known request errors into proper HTTP responses
 * instead of a raw 500. Without this, any `delete`/`update` on a missing
 * row throws a raw P2025 that Nest's default filter turns into an opaque
 * 500 - discovered while testing the workflow requirement endpoints (see
 * docs/BUILD_PROGRESS.md). Applies globally so every module benefits, not
 * just the ones that happened to be tested. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception.code === "P2025") {
      const notFound = new NotFoundException("The requested record does not exist");
      return res.status(notFound.getStatus()).json(notFound.getResponse());
    }
    if (exception.code === "P2002") {
      const conflict = new ConflictException("A record with that unique value already exists");
      return res.status(conflict.getStatus()).json(conflict.getResponse());
    }

    // Anything else is unexpected - surface as a generic 500 rather than
    // leaking Prisma internals, but don't swallow it from the logs.
    // eslint-disable-next-line no-console
    console.error("Unhandled Prisma error:", exception);
    res.status(500).json({ statusCode: 500, message: "Internal server error" });
  }
}
