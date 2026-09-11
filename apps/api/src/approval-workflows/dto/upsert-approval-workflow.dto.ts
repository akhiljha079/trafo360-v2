import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

class ApprovalStepInput {
  @IsOptional()
  @IsString()
  approverRoleId?: string;

  @IsOptional()
  @IsString()
  approverDepartmentId?: string;
}

export class UpsertApprovalWorkflowDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepInput)
  steps!: ApprovalStepInput[];
}
