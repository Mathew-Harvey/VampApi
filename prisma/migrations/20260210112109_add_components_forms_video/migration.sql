-- CreateTable
CREATE TABLE "vessel_components" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vesselId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "coatingType" TEXT,
    "material" TEXT,
    "lastInspected" DATETIME,
    "condition" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vessel_components_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "vessels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "work_form_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "vesselComponentId" TEXT NOT NULL,
    "condition" TEXT,
    "foulingRating" INTEGER,
    "foulingType" TEXT,
    "coverage" REAL,
    "measurementType" TEXT,
    "measurementValue" REAL,
    "measurementUnit" TEXT,
    "coatingCondition" TEXT,
    "corrosionType" TEXT,
    "corrosionSeverity" TEXT,
    "notes" TEXT,
    "recommendation" TEXT,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" DATETIME,
    "completedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "work_form_entries_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_form_entries_vesselComponentId_fkey" FOREIGN KEY ("vesselComponentId") REFERENCES "vessel_components" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "video_rooms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "video_rooms_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "work_form_entries_workOrderId_vesselComponentId_key" ON "work_form_entries"("workOrderId", "vesselComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "video_rooms_workOrderId_key" ON "video_rooms"("workOrderId");
