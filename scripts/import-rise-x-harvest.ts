import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const HARVEST_DIR = path.join(process.cwd(), 'rise-x-harvest');
const WORK_DETAILS_DIR = path.join(HARVEST_DIR, 'work-details');
const IMAGES_DIR = path.join(HARVEST_DIR, 'images');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const ORG_ID = 'org-franmarine';
const OWNER_EMAIL = 'mharvey@franmarine.com.au';

// ── Helpers ─────────────────────────────────────────────────────────

function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('hull') || n.includes('bow') || n.includes('transom') || n.includes('stern') || n.includes('draft')) return 'HULL';
  if (n.includes('rudder')) return 'RUDDER';
  if (n.includes('propeller') || n.includes('prop')) return 'PROPELLER';
  if (n.includes('sea chest') || n.includes('seachest') || n.includes('box cooler') || n.includes('boxcooler')) return 'SEA_CHEST';
  if (n.includes('thruster')) return 'THRUSTER';
  if (n.includes('keel') || n.includes('bilge') || n.includes('skeg')) return 'KEEL';
  if (n.includes('anode') || n.includes('iccp') || n.includes('cathodic')) return 'ANODES';
  if (n.includes('transducer') || n.includes('speed log') || n.includes('depth') || n.includes('sounder')) return 'INTAKE';
  if (n.includes('azimuth') || n.includes('stabiliser') || n.includes('actuator') || n.includes('fin')) return 'STABILISER';
  if (n.includes('moonpool')) return 'MOONPOOL';
  if (n.includes('overboard') || n.includes('discharge')) return 'DISCHARGE';
  if (n.includes('anchor')) return 'ANCHOR';
  if (n.includes('hatch') || n.includes('torpedo')) return 'HATCH';
  if (n.includes('duct') || n.includes('flanking')) return 'PROPULSION';
  if (n.includes('ballast')) return 'BALLAST';
  return 'OTHER';
}

function parseFoulingRating(frType: string | null | undefined): number | null {
  if (!frType) return null;
  const match = frType.match(/FR\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function parseCoverage(coverage: string | null | undefined): number | null {
  if (!coverage) return null;
  const range = coverage.match(/(\d+)%\s*to\s*(\d+)%/);
  if (range) return (parseInt(range[1]) + parseInt(range[2])) / 2;
  const single = coverage.match(/(\d+)%/);
  if (single) return parseInt(single[1]);
  return null;
}

function mapStatus(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('complete')) return 'COMPLETED';
  if (s.includes('progress') || s.includes('open')) return 'IN_PROGRESS';
  if (s.includes('draft') || s.includes('not started')) return 'DRAFT';
  if (s.includes('review') || s.includes('awaiting')) return 'IN_REVIEW';
  if (s.includes('cancel')) return 'CANCELLED';
  return 'IN_PROGRESS';
}

function normalizeForMatch(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null) return null;
  return Math.trunc(n);
}

function dateFromValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && value !== null) {
    const maybe = value as { date?: unknown; from?: { date?: unknown }; to?: { date?: unknown } };
    return (
      dateFromValue(maybe.date) ||
      dateFromValue(maybe.from?.date) ||
      dateFromValue(maybe.to?.date)
    );
  }
  return null;
}

function getVesselValue(vessel: any, key: string): unknown {
  if (!vessel) return undefined;
  if (key in vessel) return vessel[key];
  if (vessel.data && key in vessel.data) return vessel.data[key];
  return undefined;
}

function resolveComponentKey(
  attachmentPath: string,
  componentMap: Map<string, { id: string }>,
): string | null {
  const normalizedPath = normalizeForMatch(attachmentPath);
  if (componentMap.has(normalizedPath)) return normalizedPath;

  // Fallback fuzzy matching for naming differences like:
  // "BoxCooler-PortAft" <-> "Box Cooler - Aft"
  for (const key of componentMap.keys()) {
    if (key.includes(normalizedPath) || normalizedPath.includes(key)) {
      return key;
    }
  }

  return null;
}

/** Extract report config fields from Rise-X work detail data for the VAMP
 *  report service (WorkOrder.metadata.reportConfig). */
function buildReportConfig(workDetail: any): Record<string, unknown> {
  const data = workDetail.data || {};
  const report = data.report || {};
  const vessel = data.ranVessel || data.vessel;
  const vesselName = vessel?.displayName || vessel?.name || '';

  return {
    title: `${vesselName} – ${workDetail.displayName || 'Biofouling Inspection'}`,
    summary: report.summary || null,
    overview: report.overview || null,
    methodology: report.methodology || null,
    recommendations: report.recommendations || null,
    workInstruction: data.workInstruction || null,
    clientDetails: data.clientDetails || null,
    berthAnchorageLocation:
      data.location?.displayName || data.berthAnchorageLocation || null,
    supervisorName: data.supervisor?.name || null,
    inspectorName: 'Mat Harvey',
    repairAgentName: 'Franmarine Underwater Services',
    togglePhotoName: true,
  };
}

function buildVesselMetadata(vessel: any): string {
  return JSON.stringify({
    source: 'rise-x',
    harvestedAt: new Date().toISOString(),
    riseX: {
      id: vessel?.id ?? null,
      displayName: vessel?.displayName ?? null,
      entityType: vessel?.entityType ?? null,
      flowType: vessel?.flowType ?? null,
      flowOriginId: vessel?.flowOriginId ?? null,
      raw: vessel ?? null,
    },
  });
}

function buildWorkMetadata(workDetail: any, reportConfig: Record<string, unknown>): string {
  const data = workDetail.data || {};
  const attachments = Array.isArray(workDetail.attachments) ? workDetail.attachments : [];

  return JSON.stringify({
    source: 'rise-x',
    harvestedAt: new Date().toISOString(),
    workCode: workDetail.workCode ?? null,
    riseXId: workDetail.id ?? null,
    flowType: workDetail.flowType ?? null,
    flowOriginId: workDetail.flowOriginId ?? null,
    flowDisplayName: workDetail.flowDisplayName ?? null,
    displayName: workDetail.displayName ?? null,
    status: workDetail.status ?? null,
    currentState: workDetail.currentState ?? null,
    createdDate: workDetail.createdDate ?? null,
    lastModified: workDetail.lastModified ?? null,
    fmJobNumber: data.fmJobNumber ?? null,
    purchaseOrderNumber: data.purchaseOrderNumber ?? null,
    jobType: data.jobType ?? null,
    inspectionType: data.inspectionType ?? null,
    location: data.location ?? null,
    workSchedule: data.workSchedule ?? null,
    actualDelivery: data.actualDelivery ?? null,
    vesselAvailability: data.vesselAvailability ?? null,
    reportConfig,
    report: data.report ?? null,
    document: data.document ?? null,
    review: data.review ?? null,
    ims: data.ims ?? null,
    imsFound: data.imsFound ?? null,
    supportingWork: data.supportingWork ?? null,
    confidential: data.confidential ?? null,
    supervisor: data.supervisor ?? null,
    invites: data.invites ?? null,
    attachmentsSummary: {
      count: attachments.length,
      paths: [...new Set(attachments.map((a: any) => a?.path).filter(Boolean))],
    },
    rawData: data,
  });
}

// ── Bootstrap owner user + organisation ─────────────────────────────

async function ensureOwnerAndOrg() {
  const org = await prisma.organisation.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Franmarine Underwater Services',
      type: 'SERVICE_PROVIDER',
    },
  });

  const passwordHash = await bcrypt.hash('changeme123', 10);
  const user = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      firstName: 'Mat',
      lastName: 'Harvey',
      passwordHash,
    },
  });

  // FIX: Ensure org-franmarine is the ONLY default org for this user.
  // Without this, the user may log in under a different org and not see
  // imported vessels (vessel list is filtered by the JWT's organisationId).
  await prisma.organisationUser.updateMany({
    where: { userId: user.id, organisationId: { not: org.id } },
    data: { isDefault: false },
  });

  await prisma.organisationUser.upsert({
    where: {
      userId_organisationId: { userId: user.id, organisationId: org.id },
    },
    update: { isDefault: true, role: 'ECOSYSTEM_ADMIN', permissions: JSON.stringify(['ADMIN_FULL_ACCESS']) },
    create: {
      userId: user.id,
      organisationId: org.id,
      role: 'ECOSYSTEM_ADMIN',
      permissions: JSON.stringify(['ADMIN_FULL_ACCESS']),
      isDefault: true,
    },
  });

  return { org, user };
}

// ── Per-work-item import ────────────────────────────────────────────

interface ImportContext {
  orgId: string;
  userId: string;
}

interface GaComponent {
  id?: string;
  name?: string;
  GAComponent?: string;
  index?: number;
  frRatingData?: FrRating[];
  items?: FrRating[];
  pdrRatingData?: unknown[];
  diverSupervisorComments?: string;
  expertInspectorComments?: string;
  foulingRating?: unknown;
  pdrRating?: unknown;
}

interface FrRating {
  description?: string;
  foulingRatingType?: string;
  foulingCoverage?: string;
  pdrRating?: string;
  Comments?: string;
  comments?: string;
}

interface Attachment {
  attachmentId?: string;
  id?: string;
  unsafeOriginalFileName?: string;
  title?: string;
  path?: string;
  fileType?: string;
  attachmentType?: string;
  fullUri?: string;
  thumbUri?: string;
  createdDateTime?: string;
  createdDate?: string;
}

async function importWorkItem(workDetail: any, ctx: ImportContext) {
  const workCode: string = firstNonEmpty(workDetail.workCode, workDetail.id, 'UNKNOWN-WORK') as string;
  const vessel = workDetail.data?.ranVessel || workDetail.data?.vessel;
  if (!vessel) {
    console.log(`  SKIP ${workCode}: no vessel data`);
    return null;
  }

  const vesselExternalId: string | undefined = vessel.id;
  if (!vesselExternalId) {
    console.log(`  SKIP ${workCode}: vessel has no id (likely a flow/asset reference)`);
    return null;
  }

  const rawGA = vessel.data?.generalArrangement;
  const gaComponents: GaComponent[] = Array.isArray(rawGA) ? rawGA : [];
  const attachments: Attachment[] = workDetail.attachments || [];

  if (gaComponents.length === 0 && attachments.length === 0) {
    console.log(`  SKIP ${workCode}: empty (0 GA components, 0 attachments)`);
    return null;
  }

  const vesselName = vessel.displayName || vessel.name || 'Unknown Vessel';
  const isRan = !!workDetail.data?.ranVessel;
  const vesselType = isRan ? 'NAVAL' : 'COMMERCIAL';
  const flowType: string = workDetail.flowType || '';
  const woType = flowType.includes('biofouling') ? 'BIOFOULING_INSPECTION' : 'ENGINEERING_SERVICE';
  const location: string | null =
    workDetail.data?.location?.displayName ||
    workDetail.data?.berthAnchorageLocation ||
    null;
  const woStatus = mapStatus(workDetail.status || workDetail.currentState || '');

  console.log(
    `  Importing ${workCode}: vessel=${vesselName}, components=${gaComponents.length}, attachments=${attachments.length}`,
  );

  // Build report config from Rise-X data
  const reportConfig = buildReportConfig(workDetail);
  const vesselMetadata = buildVesselMetadata(vessel);

  // Full metadata including reportConfig
  const metadata = buildWorkMetadata(workDetail, reportConfig);

  const scheduledStart =
    dateFromValue(workDetail.data?.workSchedule?.forecastDate) ||
    dateFromValue(workDetail.data?.vesselAvailability?.from) ||
    dateFromValue(workDetail.createdDate);
  const scheduledEnd =
    dateFromValue(workDetail.data?.vesselAvailability?.to) ||
    dateFromValue(workDetail.data?.workSchedule?.to);
  const actualStart =
    dateFromValue(workDetail.data?.actualDelivery?.startDateTime) ||
    dateFromValue(workDetail.data?.actualDelivery?.from) ||
    dateFromValue(workDetail.createdDate);
  const actualEnd =
    dateFromValue(workDetail.data?.actualDelivery?.endDateTime) ||
    (woStatus === 'COMPLETED' ? dateFromValue(workDetail.lastModified) : null);

  // ── Core data inside a transaction ──────────────────────────────
  const txResult = await prisma.$transaction(
    async (tx) => {
      // 1. Vessel
      const vesselPayload = {
        name: vesselName,
        imoNumber: firstNonEmpty(getVesselValue(vessel, 'imoNumber'), getVesselValue(vessel, 'imo')),
        mmsi: firstNonEmpty(getVesselValue(vessel, 'mmsi'), getVesselValue(vessel, 'mmsiNumber')),
        callSign: firstNonEmpty(getVesselValue(vessel, 'callSign')),
        flagState: firstNonEmpty(getVesselValue(vessel, 'flagState'), getVesselValue(vessel, 'flag')),
        grossTonnage: toNumber(getVesselValue(vessel, 'grossTonnage')),
        lengthOverall: toNumber(getVesselValue(vessel, 'length')),
        beam: toNumber(getVesselValue(vessel, 'beam')),
        maxDraft: toNumber(getVesselValue(vessel, 'vesselDraft')),
        minDraft: toNumber(getVesselValue(vessel, 'vesselDraft')),
        yearBuilt: toInt(getVesselValue(vessel, 'yearBuilt')),
        homePort: firstNonEmpty(getVesselValue(vessel, 'portOfRegistry')),
        classificationSociety: firstNonEmpty(getVesselValue(vessel, 'class')),
        metadata: vesselMetadata,
      };

      const dbVessel = await tx.vessel.upsert({
        where: { externalId: vesselExternalId },
        update: vesselPayload,
        create: {
          organisationId: ctx.orgId,
          externalId: vesselExternalId,
          source: 'rise-x',
          vesselType,
          status: 'ACTIVE',
          ...vesselPayload,
        },
      });

      // 2. Vessel components (upsert by vesselId + name)
      const componentMap = new Map<string, { id: string }>();
      for (let i = 0; i < gaComponents.length; i++) {
        const ga = gaComponents[i];
        const compName = ga.name || ga.GAComponent || `Component ${i}`;
        const normalized = normalizeForMatch(compName);

        let dbComp = await tx.vesselComponent.findFirst({
          where: { vesselId: dbVessel.id, name: compName },
        });
        if (!dbComp) {
          dbComp = await tx.vesselComponent.create({
            data: {
              vesselId: dbVessel.id,
              name: compName,
              category: inferCategory(compName),
              sortOrder: ga.index ?? i,
              metadata: JSON.stringify({
                source: 'rise-x',
                riseXComponentId: ga.id ?? null,
                riseXComponentName: ga.name ?? ga.GAComponent ?? null,
                raw: ga,
              }),
            },
          });
        } else {
          dbComp = await tx.vesselComponent.update({
            where: { id: dbComp.id },
            data: {
              sortOrder: ga.index ?? i,
              category: inferCategory(compName),
              metadata: JSON.stringify({
                source: 'rise-x',
                riseXComponentId: ga.id ?? null,
                riseXComponentName: ga.name ?? ga.GAComponent ?? null,
                raw: ga,
              }),
            },
          });
        }
        componentMap.set(normalized, dbComp);
      }

      // 3. Work order — always update metadata so reportConfig is populated
      const dbWorkOrder = await tx.workOrder.upsert({
        where: { referenceNumber: workCode },
        update: {
          title: `${vesselName} – ${workDetail.displayName || woType}`,
          status: woStatus,
          location,
          description: firstNonEmpty(workDetail.data?.workInstruction, workDetail.data?.jobType, workDetail.displayName),
          scheduledStart,
          scheduledEnd,
          actualStart,
          actualEnd,
          completedAt: woStatus === 'COMPLETED' ? dateFromValue(workDetail.lastModified) : null,
          metadata,
        },
        create: {
          referenceNumber: workCode,
          vesselId: dbVessel.id,
          organisationId: ctx.orgId,
          title: `${vesselName} – ${workDetail.displayName || woType}`,
          type: woType,
          status: woStatus,
          location,
          description: firstNonEmpty(workDetail.data?.workInstruction, workDetail.data?.jobType, workDetail.displayName),
          scheduledStart,
          scheduledEnd,
          actualStart,
          actualEnd,
          completedAt:
            woStatus === 'COMPLETED' ? dateFromValue(workDetail.lastModified) : null,
          metadata,
        },
      });

      // 4. Assignment
      await tx.workOrderAssignment.upsert({
        where: {
          workOrderId_userId: {
            workOrderId: dbWorkOrder.id,
            userId: ctx.userId,
          },
        },
        update: {},
        create: {
          workOrderId: dbWorkOrder.id,
          userId: ctx.userId,
          role: 'LEAD',
        },
      });

      // 5. Inspection (biofouling only)
      let dbInspection: { id: string } | null = null;
      if (woType === 'BIOFOULING_INSPECTION') {
        const existing = await tx.inspection.findFirst({
          where: { workOrderId: dbWorkOrder.id },
        });
        if (existing) {
          dbInspection = await tx.inspection.update({
            where: { id: existing.id },
            data: {
              status: woStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
              inspectorName: 'Mat Harvey',
              location,
              startedAt: actualStart || scheduledStart || existing.startedAt,
              completedAt: woStatus === 'COMPLETED' ? dateFromValue(workDetail.lastModified) : null,
            },
          });
        } else {
          dbInspection = await tx.inspection.create({
            data: {
              workOrderId: dbWorkOrder.id,
              vesselId: dbVessel.id,
              type: 'BIOFOULING_INSPECTION',
              status: woStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
              inspectorName: 'Mat Harvey',
              location,
              startedAt: actualStart || scheduledStart || new Date(),
              completedAt:
                woStatus === 'COMPLETED' ? dateFromValue(workDetail.lastModified) : null,
            },
          });
        }
      }

      // 6. Findings + work form entries per GA component
      let findingsCreated = 0;
      let formEntriesCreated = 0;
      const findingMap = new Map<string, { id: string }>();

      for (const ga of gaComponents) {
        const compName = ga.name || ga.GAComponent || 'Unknown';
        const normalized = normalizeForMatch(compName);
        const dbComp = componentMap.get(normalized);
        if (!dbComp) continue;

        const frData: FrRating[] = ga.frRatingData || ga.items || [];
        let maxRating: number | null = null;
        let maxFrType: string | null = null;
        const coverages: number[] = [];

        for (const fr of frData) {
          const rating = parseFoulingRating(fr.foulingRatingType);
          if (rating !== null && (maxRating === null || rating > maxRating)) {
            maxRating = rating;
            maxFrType = fr.foulingRatingType || null;
          }
          const cov = parseCoverage(fr.foulingCoverage);
          if (cov !== null) coverages.push(cov);
        }

        const avgCoverage =
          coverages.length > 0
            ? coverages.reduce((a, b) => a + b, 0) / coverages.length
            : null;

        // Inspection finding
        if (dbInspection && frData.length > 0) {
          const existingFinding = await tx.inspectionFinding.findFirst({
            where: { inspectionId: dbInspection.id, area: compName },
          });

          const findingPayload = {
            inspectionId: dbInspection.id,
            area: compName,
            foulingRating: maxRating,
            foulingType: maxFrType,
            coverage: avgCoverage,
            description: ga.diverSupervisorComments || null,
            recommendation: ga.expertInspectorComments || null,
            metadata: JSON.stringify({
              source: 'rise-x',
              frRatingData: frData,
              rawComponent: ga,
            }),
          };

          const dbFinding = existingFinding
            ? await tx.inspectionFinding.update({
                where: { id: existingFinding.id },
                data: findingPayload,
              })
            : await tx.inspectionFinding.create({ data: findingPayload });

          findingMap.set(normalized, dbFinding);
          findingsCreated++;
        }

        // Work form entry
        await tx.workFormEntry.upsert({
          where: {
            workOrderId_vesselComponentId: {
              workOrderId: dbWorkOrder.id,
              vesselComponentId: dbComp.id,
            },
          },
          update: {
            foulingRating: maxRating,
            foulingType: maxFrType,
            coverage: avgCoverage,
            notes: ga.diverSupervisorComments || null,
            recommendation: ga.expertInspectorComments || null,
            status: 'COMPLETED',
          },
          create: {
            workOrderId: dbWorkOrder.id,
            vesselComponentId: dbComp.id,
            foulingRating: maxRating,
            foulingType: maxFrType,
            coverage: avgCoverage,
            notes: ga.diverSupervisorComments || null,
            recommendation: ga.expertInspectorComments || null,
            status: 'COMPLETED',
          },
        });
        formEntriesCreated++;
      }

      return {
        vesselId: dbVessel.id,
        workOrderId: dbWorkOrder.id,
        inspectionId: dbInspection?.id ?? null,
        componentMap,
        findingMap,
        findingsCreated,
        formEntriesCreated,
        componentCount: gaComponents.length,
      };
    },
    { timeout: 60_000 },
  );

  // ── Photos (outside transaction to avoid timeout) ───────────────

  // Collect photo URLs grouped by GA component (normalized attachment path)
  // so we can batch-update WorkFormEntry.attachments afterwards.
  const photosByComponent = new Map<string, string[]>();
  let photosCreated = 0;

  const imageWorkDir = path.join(IMAGES_DIR, workCode);
  if (fs.existsSync(imageWorkDir) && attachments.length > 0) {
    for (const att of attachments) {
      const attPath = att.path;
      if (!attPath) continue;

      const attId = att.attachmentId || att.id;
      if (!attId) continue;

      const originalName = att.unsafeOriginalFileName || `${att.title || attId}.jpg`;
      const ext = path.extname(originalName).toLowerCase() || '.jpg';
      const filename = `risex_${attId}${ext}`;
      const mediaUrl = `/uploads/${filename}`;
      const destPath = path.join(UPLOADS_DIR, filename);

      // Locate source file on disk
      const srcDir = path.join(imageWorkDir, attPath);
      if (!fs.existsSync(srcDir)) continue;

      let srcFile: string | null = null;
      const exactPath = path.join(srcDir, originalName);
      if (fs.existsSync(exactPath)) {
        srcFile = exactPath;
      } else {
        try {
          const dirFiles = fs.readdirSync(srcDir);
          const match = dirFiles.find(
            (f) => f.toLowerCase() === originalName.toLowerCase(),
          );
          if (match) srcFile = path.join(srcDir, match);
        } catch { /* skip */ }
      }
      if (!srcFile) continue;

      // Copy to uploads/ (skip if already exists on disk)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcFile, destPath);
      }
      const fileSize = fs.statSync(destPath).size;

      const matchedKey = resolveComponentKey(attPath, txResult.componentMap);
      if (!matchedKey) continue;
      const matchingFinding = txResult.findingMap.get(matchedKey);

      // Create Media record (idempotent)
      const existing = await prisma.media.findFirst({
        where: { storageKey: filename },
      });
      if (!existing) {
        await prisma.media.create({
          data: {
            uploaderId: ctx.userId,
            vesselId: txResult.vesselId,
            workOrderId: txResult.workOrderId,
            inspectionId: txResult.inspectionId,
            findingId: matchingFinding?.id ?? null,
            filename,
            originalName,
            mimeType: att.attachmentType || 'image/jpeg',
            size: fileSize,
            storageKey: filename,
            url: mediaUrl,
            capturedAt: att.createdDateTime || att.createdDate
              ? new Date((att.createdDateTime || att.createdDate)!)
              : null,
            tags: JSON.stringify({
              source: 'rise-x',
              workCode,
              gaComponent: attPath,
              riseXAttachmentId: attId,
            }),
          },
        });
        photosCreated++;
      }

      // Track this photo URL for the matching GA component's WorkFormEntry
      if (!photosByComponent.has(matchedKey)) {
        photosByComponent.set(matchedKey, []);
      }
      photosByComponent.get(matchedKey)!.push(mediaUrl);
    }
  }

  // ── Backfill WorkFormEntry.attachments with photo URLs ──────────
  // The work form view reads photos from this JSON array, not from Media.
  let attachmentsLinked = 0;
  for (const [normalizedPath, photoUrls] of photosByComponent) {
    const dbComp = txResult.componentMap.get(normalizedPath);
    if (!dbComp) continue;

    const entry = await prisma.workFormEntry.findUnique({
      where: {
        workOrderId_vesselComponentId: {
          workOrderId: txResult.workOrderId,
          vesselComponentId: dbComp.id,
        },
      },
    });
    if (!entry) continue;

    // Merge with any existing attachments (idempotent: deduplicate)
    const existing: string[] = safeParseJsonArray(entry.attachments);
    const existingSet = new Set(existing);
    const merged = [...existing];
    for (const url of photoUrls) {
      if (!existingSet.has(url)) {
        merged.push(url);
        existingSet.add(url);
      }
    }

    if (merged.length !== existing.length) {
      await prisma.workFormEntry.update({
        where: { id: entry.id },
        data: { attachments: JSON.stringify(merged) },
      });
      attachmentsLinked += merged.length - existing.length;
    }
  }

  if (attachmentsLinked > 0) {
    console.log(`    → Linked ${attachmentsLinked} photos to form entries`);
  }

  return {
    findings: txResult.findingsCreated,
    formEntries: txResult.formEntriesCreated,
    components: txResult.componentCount,
    photos: photosCreated,
    attachmentsLinked,
  };
}

function safeParseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('Rise-X Harvest → VAMP Import');
  console.log('============================\n');

  if (!fs.existsSync(WORK_DETAILS_DIR)) {
    console.error(`Work details directory not found: ${WORK_DETAILS_DIR}`);
    process.exit(1);
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const { org, user } = await ensureOwnerAndOrg();
  console.log(`Owner: ${user.email} (${user.id})`);
  console.log(`Org:   ${org.name} (${org.id})\n`);

  const ctx: ImportContext = { orgId: org.id, userId: user.id };
  const files = fs
    .readdirSync(WORK_DETAILS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const totals = {
    processed: 0,
    skipped: 0,
    vessels: 0,
    workOrders: 0,
    components: 0,
    findings: 0,
    formEntries: 0,
    photos: 0,
    attachmentsLinked: 0,
  };

  for (const file of files) {
    const filePath = path.join(WORK_DETAILS_DIR, file);
    const workDetail = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    try {
      const result = await importWorkItem(workDetail, ctx);
      if (result) {
        totals.processed++;
        totals.components += result.components;
        totals.findings += result.findings;
        totals.formEntries += result.formEntries;
        totals.photos += result.photos;
        totals.attachmentsLinked += result.attachmentsLinked;
      } else {
        totals.skipped++;
      }
    } catch (err: any) {
      console.error(`  ERROR importing ${file}: ${err.message}`);
    }
  }

  totals.vessels = await prisma.vessel.count({ where: { source: 'rise-x' } });
  totals.workOrders = await prisma.workOrder.count({
    where: { referenceNumber: { startsWith: 'FUS-' } },
  });

  console.log('\n════════════════════════════════════');
  console.log('        Import Summary');
  console.log('════════════════════════════════════');
  console.log(`  Files processed    : ${totals.processed}`);
  console.log(`  Files skipped      : ${totals.skipped}`);
  console.log(`  Vessels            : ${totals.vessels}`);
  console.log(`  Work Orders        : ${totals.workOrders}`);
  console.log(`  Components         : ${totals.components}`);
  console.log(`  Findings           : ${totals.findings}`);
  console.log(`  Form Entries       : ${totals.formEntries}`);
  console.log(`  Photos copied      : ${totals.photos}`);
  console.log(`  Attachments linked : ${totals.attachmentsLinked}`);
  console.log('════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
