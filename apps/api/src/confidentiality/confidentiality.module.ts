import { Module } from "@nestjs/common";
import { ConfidentialityController } from "./confidentiality.controller";

@Module({
  controllers: [ConfidentialityController],
})
export class ConfidentialityModule {}
