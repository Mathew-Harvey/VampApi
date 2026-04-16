-- CreateTable
CREATE TABLE "vessel_groups" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_group_memberships" (
    "id" TEXT NOT NULL,
    "vesselGroupId" TEXT NOT NULL,
    "vesselId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vessel_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vessel_groups_organisationId_name_key" ON "vessel_groups"("organisationId", "name");

-- CreateIndex
CREATE INDEX "vessel_group_memberships_vesselId_idx" ON "vessel_group_memberships"("vesselId");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_group_memberships_vesselGroupId_vesselId_key" ON "vessel_group_memberships"("vesselGroupId", "vesselId");

-- AddForeignKey
ALTER TABLE "vessel_groups" ADD CONSTRAINT "vessel_groups_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_group_memberships" ADD CONSTRAINT "vessel_group_memberships_vesselGroupId_fkey" FOREIGN KEY ("vesselGroupId") REFERENCES "vessel_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_group_memberships" ADD CONSTRAINT "vessel_group_memberships_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "vessels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
