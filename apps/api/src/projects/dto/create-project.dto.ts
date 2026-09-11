import { IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateProjectDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  customerPo?: string;

  @IsOptional()
  @IsDateString()
  poDate?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  transformerSerial?: string;

  @IsOptional()
  @IsString()
  transformerType?: string;

  @IsOptional()
  @IsString()
  rating?: string;

  @IsOptional()
  @IsString()
  voltage?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  targetDeliveryDate?: string;

  @IsOptional()
  @IsString()
  projectManagerId?: string;

  @IsOptional()
  @IsString()
  documentCoordinatorId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsString()
  confidentialityLevelId!: string;

  @IsOptional()
  @IsString()
  workflowTemplateId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
