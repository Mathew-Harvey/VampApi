-- AlterTable
ALTER TABLE "vessel_components" ADD COLUMN "parentId" TEXT;

-- AddForeignKey
ALTER TABLE "vessel_components" ADD CONSTRAINT "vessel_components_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "vessel_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;
