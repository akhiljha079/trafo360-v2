import { Injectable } from "@nestjs/common";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

const RESULT_LIMIT = 10;

/** Global search (spec §41) across projects/documents/physical files. Reuses
 * the exact same `confidentialityLevel.rank <= ceiling` filter every other
 * list endpoint already enforces (see ProjectsService.list,
 * DocumentsService.listAll, PhysicalFilesService.list) - a search index that
 * skipped this would leak the existence of confidential records through
 * result counts/titles even if the detail page still blocked access. */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async search(userId: string, q: string) {
    const query = q.trim();
    if (query.length < 2) return { projects: [], documents: [], physicalFiles: [] };

    const ceiling = await this.permissions.getConfidentialityRank(userId);
    const contains = { contains: query, mode: "insensitive" as const };

    const [projects, documents, physicalFiles] = await Promise.all([
      this.prisma.project.findMany({
        where: {
          confidentialityLevel: { rank: { lte: ceiling } },
          OR: [{ projectNo: contains }, { name: contains }, { customerPo: contains }, { transformerSerial: contains }],
        },
        select: { id: true, projectNo: true, name: true, status: true, customer: { select: { name: true } } },
        take: RESULT_LIMIT,
      }),
      this.prisma.document.findMany({
        where: {
          confidentialityLevel: { rank: { lte: ceiling } },
          OR: [{ title: contains }, { project: { projectNo: contains } }, { project: { name: contains } }],
        },
        select: {
          id: true,
          title: true,
          status: true,
          project: { select: { id: true, projectNo: true, name: true } },
          documentType: { select: { name: true } },
        },
        take: RESULT_LIMIT,
      }),
      this.prisma.physicalFile.findMany({
        where: {
          confidentialityLevel: { rank: { lte: ceiling } },
          OR: [{ fileCode: contains }, { project: { projectNo: contains } }, { project: { name: contains } }],
        },
        select: {
          id: true,
          fileCode: true,
          status: true,
          project: { select: { id: true, projectNo: true, name: true } },
        },
        take: RESULT_LIMIT,
      }),
    ]);

    return { projects, documents, physicalFiles };
  }
}
