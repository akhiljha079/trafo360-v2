import { Injectable } from "@nestjs/common";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";

const RESULT_LIMIT = 10;
const SNIPPET_RADIUS = 80; // chars shown on each side of the matched term

/** Builds a short "…found this…" excerpt around the first case-insensitive
 * match of `query` in `text`, or null if it's not actually in there
 * (title/project-number matches never look inside the OCR text at all). */
function buildSnippet(text: string, query: string): string | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

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
          OR: [
            { title: contains },
            { project: { projectNo: contains } },
            { project: { name: contains } },
            // OCR'd content search (dashboard search bar) - matches text
            // extracted from the file itself, not just metadata. Only
            // DONE versions have extractedText at all (PENDING/FAILED/
            // UNSUPPORTED never do), so no separate status filter needed.
            { versions: { some: { extractedText: contains } } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          project: { select: { id: true, projectNo: true, name: true } },
          documentType: { select: { name: true } },
          // Only fetched to build a snippet for whichever result actually
          // matched via content, not metadata - cheap since take:1 and
          // RESULT_LIMIT bounds the outer query to 10 documents.
          versions: {
            where: { extractedText: contains },
            orderBy: { versionNo: "desc" as const },
            take: 1,
            select: { extractedText: true },
          },
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

    // Never hand back raw OCR text (could be a full page of a document) -
    // just the short excerpt around the match, and only when the match
    // actually came from content rather than title/project.
    const documentsWithSnippets = documents.map(({ versions, ...doc }) => ({
      ...doc,
      contentSnippet: versions[0]?.extractedText ? buildSnippet(versions[0].extractedText, query) : null,
    }));

    return { projects, documents: documentsWithSnippets, physicalFiles };
  }
}
