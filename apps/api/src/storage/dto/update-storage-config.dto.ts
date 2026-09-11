import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpdateStorageConfigDto {
  @IsBoolean()
  nfsEnabled!: boolean;

  /** Informational - the Synology's address, e.g. "192.168.0.221". Not used
   * by the app directly; the actual NFS mount is an OS-level operation done
   * by the server admin (see docs), this is just recorded so it shows up
   * next to the mount path instead of only living in someone's memory. */
  @IsOptional()
  @IsString()
  nfsHost?: string;

  /** Informational - the export path, e.g. "/volume1/trafo360". */
  @IsOptional()
  @IsString()
  nfsExportPath?: string;

  /** The actual local directory the app reads/writes through - this must
   * already be the mount point of a real OS-level NFS mount (e.g. via
   * /etc/fstab) for this to do anything. Changing this value alone does
   * NOT mount anything. */
  @IsString()
  nfsMountPath!: string;
}
