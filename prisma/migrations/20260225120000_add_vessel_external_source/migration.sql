-- Add columns for third-party (e.g. Rise-X) asset sync
ALTER TABLE "vessels" ADD COLUMN "externalId" TEXT;
ALTER TABLE "vessels" ADD COLUMN "source" TEXT;
CREATE UNIQUE INDEX "vessels_externalId_key" ON "vessels"("externalId");
