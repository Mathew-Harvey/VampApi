-- AlterTable: Add ISO 6319:2026 Annex D zone mapping fields

-- vessel_components: optional ISO zone mapping alongside existing gaZoneId
ALTER TABLE "vessel_components" ADD COLUMN "isoZone" TEXT;

-- work_form_entries: ISO zone per inspection entry (inherited from component or overridden)
ALTER TABLE "work_form_entries" ADD COLUMN "isoZone" TEXT;

-- inspection_findings: denormalised ISO zone for standalone findings
ALTER TABLE "inspection_findings" ADD COLUMN "isoZone" TEXT;

-- inspections: ISO 6319:2026 Table B.1 visibility condition
ALTER TABLE "inspections" ADD COLUMN "isoVisibility" TEXT;
