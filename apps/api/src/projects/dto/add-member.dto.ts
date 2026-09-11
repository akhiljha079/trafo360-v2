import { IsOptional, IsString } from "class-validator";

export class AddProjectMemberDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  roleInProject?: string;
}
