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

/** Strip everything except letters/digits and lowercase — used to fuzzy-match
 *  GA component names (e.g. "Box Cooler - Aft") to attachment path strings
 *  (e.g. "BoxCooler-Aft"). */
function normalizeForMatch(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, '').trim() || null;
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

  await prisma.organisationUser.upsert({
    where: {
      userId_organisationId: { userId: user.id, organisationId: org.id },
    },
    update: {},
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
  const workCode: string = workDetail.workCode;
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

  // ── Core data inside a transaction ──────────────────────────────
  const txResult = await prisma.$transaction(
    async (tx) => {
      // 1. Vessel
      const dbVessel = await tx.vessel.upsert({
        where: { externalId: vesselExternalId },
        update: { name: vesselName },
        create: {
          organisationId: ctx.orgId,
          externalId: vesselExternalId,
          source: 'rise-x',
          name: vesselName,
          vesselType,
          status: 'ACTIVE',
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
            },
          });
        }
        componentMap.set(normalized, dbComp);
      }

      // 3. Work order
      const dbWorkOrder = await tx.workOrder.upsert({
        where: { referenceNumber: workCode },
        update: { status: woStatus },
        create: {
          referenceNumber: workCode,
          vesselId: dbVessel.id,
          organisationId: ctx.orgId,
          title: `${vesselName} – ${workDetail.displayName || woType}`,
          type: woType,
          status: woStatus,
          location,
          scheduledStart: workDetail.createdDate
            ? new Date(workDetail.createdDate)
            : null,
          actualStart: workDetail.createdDate
            ? new Date(workDetail.createdDate)
            : null,
          completedAt:
            woStatus === 'COMPLETED' && workDetail.lastModified
              ? new Date(workDetail.lastModified)
              : null,
          metadata: JSON.stringify({
            workCode,
            riseXId: workDetail.id,
            flowType,
            flowDisplayName: workDetail.flowDisplayName,
          }),
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
          dbInspection = existing;
        } else {
          dbInspection = await tx.inspection.create({
            data: {
              workOrderId: dbWorkOrder.id,
              vesselId: dbVessel.id,
              type: 'BIOFOULING_INSPECTION',
              status: woStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
              inspectorName: 'Mat Harvey',
              location,
              startedAt: workDetail.createdDate
                ? new Date(workDetail.createdDate)
                : new Date(),
              completedAt:
                woStatus === 'COMPLETED' && workDetail.lastModified
                  ? new Date(workDetail.lastModified)
                  : null,
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
            metadata: JSON.stringify(frData),
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
      const destPath = path.join(UPLOADS_DIR, filename);

      // Locate source file on disk
      const srcDir = path.join(imageWorkDir, attPath);
      if (!fs.existsSync(srcDir)) continue;

      let srcFile: string | null = null;
      const exactPath = path.join(srcDir, originalName);
      if (fs.existsSync(exactPath)) {
        srcFile = exactPath;
      } else {
        // Case-insensitive fallback
        try {
          const dirFiles = fs.readdirSync(srcDir);
          const match = dirFiles.find(
            (f) => f.toLowerCase() === originalName.toLowerCase(),
          );
          if (match) srcFile = path.join(srcDir, match);
        } catch {
          /* empty dir or permission error */
        }
      }
      if (!srcFile) continue;

      // Copy to uploads/ (skip if already exists)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcFile, destPath);
      }
      const fileSize = fs.statSync(destPath).size;

      // Resolve related finding
      const normalizedPath = normalizeForMatch(attPath);
      const matchingFinding = txResult.findingMap.get(normalizedPath);

      // Idempotent: skip if media already exists
      const existing = await prisma.media.findFirst({
        where: { storageKey: filename },
      });
      if (existing) continue;

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
          url: `/uploads/${filename}`,
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
  }

  return {
    findings: txResult.findingsCreated,
    formEntries: txResult.formEntriesCreated,
    components: txResult.componentCount,
    photos: photosCreated,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('Rise-X Harvest → VAMP Import');
  console.log('============================\n');

  if (!fs.existsSync(WORK_DETAILS_DIR)) {
    console.error(`Work details directory not found: ${WORK_DETAILS_DIR}`);
    process.exit(1);
  }

  // Ensure uploads dir exists
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
      } else {
        totals.skipped++;
      }
    } catch (err: any) {
      console.error(`  ERROR importing ${file}: ${err.message}`);
    }
  }

  // Final vessel / work order counts from DB
  totals.vessels = await prisma.vessel.count({ where: { source: 'rise-x' } });
  totals.workOrders = await prisma.workOrder.count({
    where: { referenceNumber: { startsWith: 'FUS-' } },
  });

  console.log('\n════════════════════════════');
  console.log('   Import Summary');
  console.log('════════════════════════════');
  console.log(`  Files processed : ${totals.processed}`);
  console.log(`  Files skipped   : ${totals.skipped}`);
  console.log(`  Vessels         : ${totals.vessels}`);
  console.log(`  Work Orders     : ${totals.workOrders}`);
  console.log(`  Components      : ${totals.components}`);
  console.log(`  Findings        : ${totals.findings}`);
  console.log(`  Form Entries    : ${totals.formEntries}`);
  console.log(`  Photos copied   : ${totals.photos}`);
  console.log('════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
