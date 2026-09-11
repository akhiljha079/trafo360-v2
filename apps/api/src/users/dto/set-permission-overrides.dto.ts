import { Type } from "class-transformer";
import { IsArray, IsIn, IsString, ValidateNested } from "class-validator";

class OverrideEntry {
  @IsString()
  permissionCode!: string;

  @IsIn(["GRANT", "REVOKE"])
  effect!: "GRANT" | "REVOKE";

  @IsString()
  reason?: string;
}

export class SetPermissionOverridesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverrideEntry)
  overrides!: OverrideEntry[];
}
