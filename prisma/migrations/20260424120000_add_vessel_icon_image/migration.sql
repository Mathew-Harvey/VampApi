-- AlterTable: add optional base64-encoded icon image for vessels.
ALTER TABLE "vessels" ADD COLUMN "iconImage" TEXT;
