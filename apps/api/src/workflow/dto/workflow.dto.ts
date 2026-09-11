import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpsertWorkflowTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CloneWorkflowTemplateDto {
  @IsString()
  name!: string;
}

export class UpsertParentStageDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;
}

export class ReorderDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class UpsertStageDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  responsibleDepartmentId?: string;

  @IsOptional()
  @IsString()
  responsibleRoleId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;
}

export class UpsertRequirementDto {
  @IsString()
  documentTypeId!: string;

  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @IsOptional()
  @IsString()
  approvalWorkflowId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;
}

export class OverrideProjectRequirementDto {
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  notApplicable?: boolean;

  @IsString()
  reason!: string;
}
