import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { getNfsRoot } from "./storage-config";

const execFileAsync = promisify(execFile);

const BATCH_SIZE = 5;
const TOOL_TIMEOUT_MS = 60_000;
const MAX_STORED_CHARS = 500_000; // a few hundred pages of text - plenty for search, bounds DB row size
const MIN_TEXT_LENGTH_FOR_EMBEDDED_LAYER = 20; // below this, treat a PDF as scanned/no text layer

const OCR_SUPPORTED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

/** Document content search (dashboard OCR search bar). Runs as its own
 * worker poll, same pattern as runSyncCycle/runOverdueCheck - extraction
 * can take several seconds per file, far too slow for the upload request
 * to wait on.
 *
 * Two extraction paths depending on the file:
 *  - PDF: try `pdftotext` first (poppler-utils) - free and instant for a
 *    born-digital PDF with a real text layer, which is most engineering
 *    documents. Only falls through to actual OCR (rasterize each page with
 *    `pdftoppm`, then `tesseract` each page image) when that comes back
 *    empty/near-empty, i.e. a scanned PDF with no text layer.
 *  - JPEG/PNG: straight to `tesseract`.
 *  - Anything else (docx, dwg, zip, ...): marked UNSUPPORTED, not FAILED -
 *    there's nothing to extract, that's not an error.
 *
 * Shells out to system binaries (tesseract-ocr + poppler-utils, installed
 * by install.sh) rather than an npm OCR package - avoids fighting native
 * module bindings on the server, same reasoning as this app's Chromium
 * dependency handling for WhatsApp Web. */
export async function runOcrCycle(prisma: PrismaClient): Promise<void> {
  const pending = await prisma.documentVersion.findMany({
    where: { ocrStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  if (pending.length === 0) return;

  const nfsRoot = await getNfsRoot(prisma);
  const localRoot = path.resolve(process.env.LOCAL_STORAGE_PATH ?? "./storage/local");

  for (const version of pending) {
    if (!OCR_SUPPORTED_MIME_TYPES.has(version.mimeType)) {
      await prisma.documentVersion.update({ where: { id: version.id }, data: { ocrStatus: "UNSUPPORTED" } });
      continue;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trafo360-ocr-"));
    try {
      const isNfs = version.storageStatus === "NFS_STORED" || version.storageStatus === "SYNCED";
      const sourcePath = path.join(isNfs ? nfsRoot : path.join(localRoot, "pending"), version.storagePath);
      const workFile = path.join(tmpDir, `input${path.extname(version.fileName) || guessExt(version.mimeType)}`);
      await fs.copyFile(sourcePath, workFile);

      const text = await extractText(workFile, version.mimeType, tmpDir);
      const trimmed = text.trim();

      if (trimmed.length === 0) {
        await prisma.documentVersion.update({ where: { id: version.id }, data: { ocrStatus: "FAILED" } });
        // eslint-disable-next-line no-console
        console.log(`[worker] OCR produced no text for ${version.id} (${version.fileName}) - marked FAILED`);
      } else {
        await prisma.documentVersion.update({
          where: { id: version.id },
          data: { extractedText: trimmed.slice(0, MAX_STORED_CHARS), ocrStatus: "DONE" },
        });
        // eslint-disable-next-line no-console
        console.log(`[worker] extracted ${trimmed.length} chars from ${version.id} (${version.fileName})`);
      }
    } catch (err) {
      await prisma.documentVersion.update({ where: { id: version.id }, data: { ocrStatus: "FAILED" } });
      // eslint-disable-next-line no-console
      console.warn(`[worker] OCR failed for ${version.id} (${version.fileName}): ${(err as Error).message}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

function guessExt(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  return "";
}

async function extractText(filePath: string, mimeType: string, tmpDir: string): Promise<string> {
  if (mimeType.startsWith("image/")) {
    return ocrImage(filePath);
  }

  // application/pdf: embedded text layer first, actual OCR only if that's empty.
  const embedded = await runTool("pdftotext", [filePath, "-"]);
  if (embedded.trim().length >= MIN_TEXT_LENGTH_FOR_EMBEDDED_LAYER) {
    return embedded;
  }
  return ocrPdfPages(filePath, tmpDir);
}

async function ocrImage(filePath: string): Promise<string> {
  // tesseract's documented special case: "stdout" as the output base name
  // (not a real file) makes it write recognized text to actual stdout
  // instead of "<base>.txt".
  return runTool("tesseract", [filePath, "stdout"]);
}

async function ocrPdfPages(filePath: string, tmpDir: string): Promise<string> {
  const pagePrefix = path.join(tmpDir, "page");
  await runTool("pdftoppm", ["-png", "-r", "150", filePath, pagePrefix]);
  const files = (await fs.readdir(tmpDir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
  const pageTexts: string[] = [];
  for (const file of files) {
    pageTexts.push(await ocrImage(path.join(tmpDir, file)));
  }
  return pageTexts.join("\n\n");
}

async function runTool(bin: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, { timeout: TOOL_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}
