import "reflect-metadata";
import {
  Logger,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ApiController } from "./modules/api/api.controller.js";
import { AwarderService } from "./modules/awarder/awarder.service.js";
import { ChainService } from "./modules/chain/chain.service.js";
import { ClarificationsService } from "./modules/clarifications/clarifications.service.js";
import { DocumentsService } from "./modules/documents/documents.service.js";
import { DocumentsSweeper } from "./modules/documents/documents.sweeper.js";
import { EvaluatorScheduler } from "./modules/evaluator/evaluator.scheduler.js";
import { EvaluatorService } from "./modules/evaluator/evaluator.service.js";
import { IndexerService } from "./modules/indexer/indexer.service.js";
import { DirectoryService } from "./modules/reputation/directory.service.js";
import { ReputationService } from "./modules/reputation/reputation.service.js";
import { StatsService } from "./modules/reputation/stats.service.js";
import { X402Middleware } from "./modules/x402/x402.middleware.js";

@Module({
  controllers: [ApiController],
  providers: [
    ChainService,
    IndexerService,
    EvaluatorService,
    EvaluatorScheduler,
    AwarderService,
    X402Middleware,
    DocumentsService,
    DocumentsSweeper,
    ReputationService,
    DirectoryService,
    StatsService,
    ClarificationsService,
  ],
})
export class AppModule implements NestModule {
  /**
   * Only the endpoint that spends inference is metered. `GET /rfqs/:id/evaluation` and
   * `GET /audit/:id` are left open on purpose: a bidder checking why they lost must never have to
   * pay to see it, and the scheduler scores on its own anyway, so the paid route is genuinely a
   * "score this now" service rather than a toll on reading the outcome.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(X402Middleware)
      .forRoutes({ path: "rfqs/:id/evaluate", method: RequestMethod.POST });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  /**
   * Comma-separated, because a site is usually reachable at more than one hostname.
   *
   * `sealedrfq.com` redirects to `www.sealedrfq.com`, so the browser's Origin is the www host
   * whichever one was typed. Setting this to the apex alone blocks every browser call while every
   * server-rendered one keeps working — which presents as the board loading normally and uploads
   * failing with "Failed to fetch", and sends you looking at the upload code.
   */
  const origins = (process.env.CORS_ORIGIN ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length === 1 ? origins[0] : origins });
  const port = Number(process.env.PORT ?? 4020);
  await app.listen(port);
  new Logger("bootstrap").log(`SealedRFQ agent listening on :${port}`);
}

void bootstrap();
