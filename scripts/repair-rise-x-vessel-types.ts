/**
 * Repair script: re-derive vesselType for every vessel imported from Rise-X.
 *
 * Why: an earlier version of scripts/import-rise-x-harvest.ts stored the
 * placeholder values "NAVAL" / "COMMERCIAL" in Vessel.vesselType. Those
 * strings are not valid VAMP vessel types, so the Digital Twin falls
 * through to the default cargo-ship 3D model for every imported vessel.
 *
 * The original Rise-X vessel payload is preserved on Vessel.metadata.riseX.raw
 * (populated by buildVesselMetadata in the importer), so we re-read that and
 * run the same inference that the importer now does.
 *
 * Usage:
 *   npx tsx scripts/repair-rise-x-vessel-types.ts          # apply updates
 *   DRY_RUN=1 npx tsx scripts/repair-rise-x-vessel-types.ts # preview only
 */

import { PrismaClient } from '@prisma/client';
import { inferVesselType } from './rise-x-vessel-type';

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

// Legacy placeholder values that mean "the old importer wrote garbage here".
// Everything else is considered a real user-assigned or previously-repaired
// type and is left alone unless FORCE=1 is set.
const LEGACY_PLACEHOLDERS = new Set(['NAVAL', 'COMMERCIAL', '', 'UNKNOWN']);
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function getVesselValue(vessel: any, key: string): unknown {
  if (!vessel) return undefined;
  if (key in vessel) return vessel[key];
  if (vessel.data && typeof vessel.data === 'object' && key in vessel.data) {
    return vessel.data[key];
  }
  return undefined;
}

async function main() {
  console.log('Rise-X vessel type repair');
  console.log('=========================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`);
  console.log(`Scope: ${FORCE ? 'ALL rise-x vessels' : 'rise-x vessels with legacy placeholder types'}\n`);

  const vessels = await prisma.vessel.findMany({
    where: { source: 'rise-x', isDeleted: false },
    select: {
      id: true,
      name: true,
      vesselType: true,
      metadata: true,
      externalId: true,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${vessels.length} rise-x vessels.\n`);

  const summary = {
    examined: 0,
    skippedNotPlaceholder: 0,
    skippedNoMetadata: 0,
    unchanged: 0,
    updated: 0,
    byType: new Map<string, number>(),
  };

  for (const v of vessels) {
    summary.examined++;

    if (!FORCE && !LEGACY_PLACEHOLDERS.has(v.vesselType)) {
      summary.skippedNotPlaceholder++;
      continue;
    }

    let raw: any = null;
    try {
      const parsed = v.metadata ? JSON.parse(v.metadata) : null;
      raw = parsed?.riseX?.raw ?? null;
    } catch {
      raw = null;
    }

    if (!raw) {
      summary.skippedNoMetadata++;
      console.log(`  ? ${v.name.padEnd(30)}  (no rise-x metadata — left as ${v.vesselType})`);
      continue;
    }

    const rawTypeString = firstNonEmpty(
      getVesselValue(raw, 'type'),
      getVesselValue(raw, 'vesselType'),
      getVesselValue(raw, 'shipType'),
    );
    const isRan = raw?.entityType === 'RANVessel' || raw?.flowType?.toString().toLowerCase().includes('ranvessel');
    const nextType = inferVesselType(rawTypeString, v.name, Boolean(isRan));

    if (nextType === v.vesselType) {
      summary.unchanged++;
      console.log(`  = ${v.name.padEnd(30)}  ${v.vesselType.padEnd(18)}  (already correct)`);
      continue;
    }

    summary.updated++;
    summary.byType.set(nextType, (summary.byType.get(nextType) ?? 0) + 1);

    const sourceLabel = rawTypeString || '(no type on record)';
    console.log(
      `  ${DRY_RUN ? '·' : '→'} ${v.name.padEnd(30)}  ${v.vesselType.padEnd(18)} → ${nextType.padEnd(18)}  [${sourceLabel}]`,
    );

    if (!DRY_RUN) {
      await prisma.vessel.update({
        where: { id: v.id },
        data: { vesselType: nextType },
      });
    }
  }

  console.log('\n──────────────────────────────────────');
  console.log('            Repair Summary');
  console.log('──────────────────────────────────────');
  console.log(`  Examined              : ${summary.examined}`);
  console.log(`  Skipped (not legacy)  : ${summary.skippedNotPlaceholder}`);
  console.log(`  Skipped (no metadata) : ${summary.skippedNoMetadata}`);
  console.log(`  Already correct       : ${summary.unchanged}`);
  console.log(`  ${DRY_RUN ? 'Would update' : 'Updated'.padEnd(21)}: ${summary.updated}`);

  if (summary.byType.size > 0) {
    console.log('\n  New type distribution:');
    for (const [type, count] of [...summary.byType.entries()].sort()) {
      console.log(`    ${type.padEnd(20)} ${count}`);
    }
  }
  console.log('──────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
