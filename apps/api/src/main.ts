import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { RequestLoggerInterceptor } from "./common/request-logger.interceptor";

// Prisma's BigInt (DocumentVersion.sizeBytes) has no native JSON
// representation - Express's res.json() throws on it otherwise. Stringify
// rather than Number() to avoid silent precision loss for very large files.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Trust the reverse proxy's X-Forwarded-For (nginx, per
  // nginx/trafo360.conf.example) so rate limiting and audit-log IPs reflect
  // the real client, not the proxy's own address for every request.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggerInterceptor());
  app.enableCors({ origin: process.env.APP_URL ?? "http://localhost:5173", credentials: true });
  app.setGlobalPrefix("api");

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
}

bootstrap();
