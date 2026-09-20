import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ApiController } from "./modules/api/api.controller.js";
import { AwarderService } from "./modules/awarder/awarder.service.js";
import { ChainService } from "./modules/chain/chain.service.js";
import { EvaluatorScheduler } from "./modules/evaluator/evaluator.scheduler.js";
import { EvaluatorService } from "./modules/evaluator/evaluator.service.js";
import { IndexerService } from "./modules/indexer/indexer.service.js";

@Module({
  controllers: [ApiController],
  providers: [ChainService, IndexerService, EvaluatorService, EvaluatorScheduler, AwarderService],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? "*" });
  const port = Number(process.env.PORT ?? 4020);
  await app.listen(port);
  new Logger("bootstrap").log(`SealedRFQ agent listening on :${port}`);
}

void bootstrap();
