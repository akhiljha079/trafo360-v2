import { PartialType } from "@nestjs/mapped-types";
import { IsDateString, IsOptional, IsString } from "class-validator";
import { CreateProjectDto } from "./create-project.dto";

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @IsOptional()
  @IsDateString()
  actualDispatchDate?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
