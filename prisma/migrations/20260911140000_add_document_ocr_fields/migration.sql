-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN "extractedText" TEXT,
ADD COLUMN "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "DocumentVersion_ocrStatus_idx" ON "DocumentVersion"("ocrStatus");
