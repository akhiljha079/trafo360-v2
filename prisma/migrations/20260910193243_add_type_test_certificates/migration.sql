-- CreateTable
CREATE TABLE "TypeTestCertificate" (
    "id" TEXT NOT NULL,
    "transformerType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "certificateNo" TEXT,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "storageStatus" TEXT NOT NULL DEFAULT 'NFS_STORED',
    "checksum" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "lastReminderSentAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypeTestCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TypeTestCertificate_expiryDate_idx" ON "TypeTestCertificate"("expiryDate");

-- AddForeignKey
ALTER TABLE "TypeTestCertificate" ADD CONSTRAINT "TypeTestCertificate_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
