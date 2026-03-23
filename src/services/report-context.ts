import prisma from '../config/database';
import { type FoulingScale, formatFoulingValue, formatFoulingValueRich, formatCoverageRich } from '../constants/fouling-scales';
import { formatPdrValue } from '../constants/pdr-scale';
import { getIsoZone, ISO_HULL_ZONES, ISO_NICHE_ZONES, ISO_VISIBILITY_CONDITIONS, ISO_AFC_CONDITIONS, ISO_MGPS_CONDITIONS } from '../constants/iso-zones';
import { workFormService } from './work-form.service';
import {
  type ReportAttachment,
  type ReportConfig,
  type MediaInfo,
  type FrRatingDataRow,
  parseAttachmentArray,
  extractMediaId,
  resolveAttachmentSource,
  getReportConfig,
  pickConfiguredImage,
  escapeHtml,
} from './report-helpers';

/** Build attachments list for template: path + fullApiUrl per image, keyed by component or special labels */
export async function buildAttachments(
  entries: Array<{ component: string; attachments: unknown }>,
  pinnedAttachments: Array<{ path: string; attachment: unknown; title?: string }> = []
): Promise<ReportAttachment[]> {
  const list: ReportAttachment[] = [];
  let reportCoverAdded = false;
  const mediaIdSet = new Set<string>();
  const parsedByEntry = new Map<string, unknown[]>();
  const pinnedItems = pinnedAttachments.filter((x) => x.attachment != null);

  for (const entry of entries) {
    const parsed = parseAttachmentArray(entry.attachments);
    parsedByEntry.set(entry.component, parsed);
    for (const value of parsed) {
      const maybeId = extractMediaId(value);
      if (maybeId) mediaIdSet.add(maybeId);
    }
  }
  for (const pinned of pinnedItems) {
    const maybeId = extractMediaId(pinned.attachment);
    if (maybeId) mediaIdSet.add(maybeId);
  }

  const mediaMap = new Map<string, MediaInfo>();
  const mediaIds = Array.from(mediaIdSet);
  if (mediaIds.length > 0) {
    const mediaRecords = await prisma.media.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, url: true, originalName: true, createdAt: true, capturedAt: true },
    });
    for (const media of mediaRecords) {
      mediaMap.set(media.id, {
        url: media.url,
        originalName: media.originalName,
        createdAt: media.createdAt,
        capturedAt: media.capturedAt,
      });
    }
  }

  for (const pinned of pinnedItems) {
    const resolved = resolveAttachmentSource(pinned.attachment, mediaMap, pinned.title);
    if (!resolved?.url) continue;
    list.push({
      path: pinned.path,
      fullApiUrl: resolved.url,
      fullUri: resolved.url,
      id: `pinned-${pinned.path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: resolved.title || pinned.title || pinned.path,
    });
    if (pinned.path === 'ReportCover') {
      reportCoverAdded = true;
    }
  }

  for (const entry of entries) {
    const sourceItems = parsedByEntry.get(entry.component) ?? [];
    const componentPath = (entry.component || '').trim();
    const slug = componentPath.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'section';
    let index = 0;

    for (const sourceItem of sourceItems) {
      const resolved = resolveAttachmentSource(sourceItem, mediaMap, componentPath);
      if (!resolved?.url) continue;

      const item = {
        path: resolved.path || componentPath,
        fullApiUrl: resolved.url,
        fullUri: resolved.url,
        id: `${slug}-${index}${resolved.idSuffix ? `-${resolved.idSuffix}` : ''}`,
        title: resolved.title || componentPath || 'Photo',
      };
      list.push(item);
      if (!reportCoverAdded) {
        list.push({
          path: 'ReportCover',
          fullApiUrl: resolved.url,
          fullUri: resolved.url,
          id: 'report-cover',
          title: 'Report Cover',
        });
        reportCoverAdded = true;
      }
      index += 1;
    }
  }

  return list;
}

/** Map form data + photoPages into the report template context (data.*, createdBy, attachments, etc.) */
export async function buildInspectionReportContext(
  formData: Awaited<ReturnType<typeof workFormService.getFormDataJson>>,
  photoPages: Array<{ sectionName: string; photos: Array<{ src: string; caption: string }> }>
) {
  const { workOrder, vessel, organisation, team, entries } = formData;
  const reportConfig = getReportConfig((workOrder as any).metadata);
  const inspectionDate = workOrder.actualStart ?? workOrder.actualEnd ?? workOrder.scheduledStart ?? new Date();
  const dateObj = inspectionDate instanceof Date ? inspectionDate : new Date(inspectionDate);

  // generalArrangement: one block per entry, with frRatingData for template tables (never empty so TOC safe)
  // Sub-component entries appear as additional rows within the parent's frRatingData table.
  // Only include entries where the user has entered some inspection data (parent or sub-components).
  //
  // Determine the fouling scale: prefer the explicit foulingScale field on the work order,
  // fall back to legacy heuristic for older work orders that predate the field.
  const explicitScale = (workOrder as any).foulingScale as FoulingScale | null | undefined;
  const legacyIsLoF = workOrder.type?.toLowerCase().includes('biofouling') || workOrder.type === 'NZ CRMS Biofouling Inspection';
  const useLoF = explicitScale === 'LOF' || (!explicitScale && legacyIsLoF);
  const useFR = explicitScale === 'FR' || (!explicitScale && !legacyIsLoF);
  const activeFoulingScale: FoulingScale = useLoF ? 'LOF' : 'FR';

  const LEGACY_PDR_MAP: Record<string, number> = {
    'intact': 10,
    'minor damage': 20,
    'moderate damage': 40,
    'severe damage': 70,
    'failed': 90,
  };

  function formatPdr(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'number') return formatPdrValue(value);
    if (typeof value === 'string' && value.length > 0) {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 100) return formatPdrValue(num);
      // Map legacy text values to numeric PDR
      const mapped = LEGACY_PDR_MAP[value.toLowerCase().trim()];
      if (mapped != null) return formatPdrValue(mapped);
      return value;
    }
    return null;
  }

  /** Returns true if a single form entry has any user-entered inspection data. */
  function entryHasData(e: typeof entries[0]): boolean {
    return !!(
      e.condition ||
      e.foulingRating != null ||
      e.foulingType ||
      e.coverage != null ||
      e.measurementType ||
      e.measurementValue != null ||
      e.coatingCondition ||
      e.corrosionType ||
      e.corrosionSeverity ||
      e.notes ||
      e.recommendation ||
      e.actionRequired ||
      (Array.isArray(e.attachments) && e.attachments.length > 0)
    );
  }

  /** Returns true if a parent entry or any of its sub-entries have user data. */
  function entryOrSubsHaveData(entry: typeof entries[0]): boolean {
    if (entryHasData(entry)) return true;
    const subs = (entry as any).subEntries as typeof entries | undefined;
    if (subs && subs.length > 0) {
      return subs.some((sub) => entryHasData(sub));
    }
    return false;
  }

  function buildFrRow(desc: string, e: typeof entries[0], isSub = false): FrRatingDataRow | null {
    const cat = e.category ?? '';

    if (cat === 'ANODES') {
      const wastage = (e as any).measurementValue;
      if (e.condition || wastage != null || e.foulingRating != null || e.coatingCondition || e.notes) {
        return {
          description: desc,
          conditionRating: e.condition ?? null,
          levelOfFoulingLoF: useLoF && e.foulingRating != null ? formatFoulingValueRich(e.foulingRating, 'LOF') : null,
          foulingRatingType: useFR && e.foulingRating != null ? formatFoulingValueRich(e.foulingRating, 'FR') : null,
          foulingCoverage: e.coverage != null ? formatCoverageRich(e.coverage) : (wastage != null ? `${wastage}% wastage` : null),
          pdrRating: formatPdr(e.coatingCondition),
          Comments: e.notes ?? null,
          isSubComponent: isSub,
        };
      }
      return null;
    }

    if (cat === 'PROPELLER') {
      if (e.condition || e.coatingCondition || e.foulingRating != null || e.corrosionType || e.notes) {
        const damageNote = e.corrosionType ? `${e.corrosionType}${e.corrosionSeverity ? ` (${e.corrosionSeverity})` : ''}` : null;
        return {
          description: desc,
          conditionRating: e.condition ?? null,
          levelOfFoulingLoF: useLoF && e.foulingRating != null ? formatFoulingValueRich(e.foulingRating, 'LOF') : null,
          foulingRatingType: useFR && e.foulingRating != null ? formatFoulingValueRich(e.foulingRating, 'FR') : null,
          foulingCoverage: e.coverage != null ? formatCoverageRich(e.coverage) : null,
          pdrRating: formatPdr(e.coatingCondition),
          Comments: [damageNote, e.notes].filter(Boolean).join('. ') || null,
          isSubComponent: isSub,
        };
      }
      return null;
    }

    if (useLoF && (e.foulingRating != null || e.notes || e.coatingCondition)) {
      return {
        description: desc,
        conditionRating: e.condition ?? null,
        levelOfFoulingLoF: e.foulingRating != null ? formatFoulingValueRich(e.foulingRating, 'LOF') : null,
        foulingCoverage: e.coverage != null ? formatCoverageRich(e.coverage) : null,
        pdrRating: formatPdr(e.coatingCondition),
        Comments: e.notes ?? null,
        isSubComponent: isSub,
      };
    }
    if (e.foulingRating != null || e.foulingType || e.coverage != null || e.coatingCondition || e.notes || e.condition) {
      return {
        description: desc,
        conditionRating: e.condition ?? null,
        foulingRatingType: useFR && e.foulingRating != null
          ? formatFoulingValueRich(e.foulingRating, 'FR')
          : (e.foulingType ?? null),
        foulingCoverage: e.coverage != null ? formatCoverageRich(e.coverage) : null,
        pdrRating: formatPdr(e.coatingCondition),
        Comments: e.notes ?? null,
        isSubComponent: isSub,
      };
    }
    return null;
  }

  // Filter to only include GA sections where the user entered some data
  const entriesWithData = entries.filter(entryOrSubsHaveData);

  const generalArrangement = entriesWithData.length === 0
    ? [{ id: '', name: '—', diverSupervisorComments: '', expertInspectorComments: '', frRatingData: [{}], comments: '' }]
    : entriesWithData.map((entry) => {
    const frRatingData: FrRatingDataRow[] = [];
    const desc = entry.component || 'No description';

    const parentRow = buildFrRow(desc, entry);
    if (parentRow) frRatingData.push(parentRow);

    // Append sub-component rows under the parent, visually distinct in the table
    const subEntries = (entry as any).subEntries as typeof entries | undefined;
    const subComponentNames: string[] = [];
    if (subEntries && subEntries.length > 0) {
      for (const sub of subEntries) {
        const subName = sub.component || 'Sub-component';
        subComponentNames.push(subName);
        const subRow = buildFrRow(subName, sub, true);
        if (subRow) frRatingData.push(subRow);
      }
    }

    const allNotes = [entry.notes];
    const allRecs = [entry.recommendation];
    if (subEntries) {
      for (const sub of subEntries) {
        if (sub.notes) allNotes.push(`${sub.component}: ${sub.notes}`);
        if (sub.recommendation) allRecs.push(`${sub.component}: ${sub.recommendation}`);
      }
    }

    const diverSupervisorComments = allNotes.filter(Boolean).map((n) => `<p>${escapeHtml(String(n))}</p>`).join('');
    const expertInspectorComments = allRecs.filter(Boolean).map((r) => `<p>${escapeHtml(String(r))}</p>`).join('');
    const comments = [...allNotes, ...allRecs].filter(Boolean).join(' ') || '';

    return {
      id: (entry as any).id ?? entry.component?.replace(/\s+/g, '-') ?? '',
      name: entry.component || 'Section',
      diverSupervisorComments,
      expertInspectorComments,
      frRatingData: frRatingData.length ? frRatingData : [{ description: desc, conditionRating: null, levelOfFoulingLoF: null, foulingRatingType: null, foulingCoverage: null, pdrRating: null, Comments: null }],
      comments,
      hasSubComponents: subComponentNames.length > 0,
      subComponentNames,
    };
  });

  const supervisor = team && team.length > 0 ? { name: team[0].name } : { name: '' };
  const divers = team?.filter((t) => (t as any).role?.toLowerCase?.().includes('diver'))?.map((t) => ({ diverName: t.name })) ?? [];
  const inspector = team?.length ? { name: team[team.length - 1].name } : { name: '' };
  const supervisorSignoff = reportConfig.signoff?.supervisor ?? {};
  const inspectorSignoff = reportConfig.signoff?.inspector ?? {};
  const repairSignoff = reportConfig.signoff?.repair ?? {};

  const data = {
    jobType: workOrder.type || 'Inspection',
    foulingScale: activeFoulingScale,
    supportingWork: reportConfig.title ?? workOrder.title ?? '',
    confidential: reportConfig.confidential ?? null,
    workInstruction: reportConfig.workInstruction ?? workOrder.description ?? null,
    actualDelivery: {
      startDateTime: { date: dateObj, offset: 0 },
    },
    ranVessel: {
      displayName: vessel.name,
      imo: vessel.imoNumber ?? null,
      commissioned: vessel.yearBuilt ?? null,
      grossTonnage: vessel.grossTonnage ?? null,
      length: vessel.lengthOverall ?? null,
      beam: vessel.beam ?? null,
      vesselDraft: vessel.maxDraft ?? null,
      data: {
        name: vessel.name,
        imo: vessel.imoNumber ?? null,
        commissioned: vessel.yearBuilt ?? null,
        grossTonnage: vessel.grossTonnage ?? null,
        length: vessel.lengthOverall ?? null,
        beam: vessel.beam ?? null,
        vesselDraft: vessel.maxDraft ?? null,
        generalArrangement,
      },
    },
    report: {
      summary: reportConfig.summary ?? null,
      overview: reportConfig.overview ?? null,
      methodology: reportConfig.methodology ?? null,
      recommendations: reportConfig.recommendations ?? null,
    },
    visibility: reportConfig.visibility ?? null,
    clientDetails: reportConfig.clientDetails ?? null,
    invites: {
      buyer: [{ name: reportConfig.buyerName ?? null }],
      reviewerName: reportConfig.reviewerName ?? null,
    },
    location: {
      data: { displayName: workOrder.location ?? null },
      displayName: workOrder.location ?? null,
    },
    berthAnchorageLocation: reportConfig.berthAnchorageLocation ?? workOrder.location ?? '',
    supervisor: { name: reportConfig.supervisorName ?? supervisorSignoff.name ?? supervisor.name },
    resourcing: {
      toggleRovUse: reportConfig.toggleRovUse ? 'true' : null,
      rovDetails: reportConfig.rovDetails ?? null,
    },
    repairAgent: { name: reportConfig.repairAgentName ?? null },
    inspector: { name: reportConfig.inspectorName ?? inspectorSignoff.name ?? inspector.name },
    divers,
    inspectionType: workOrder.type || 'Inspection',
    togglePhotoName: { checked: Boolean(reportConfig.togglePhotoName) },
    diveSupervisor: {
      declaration: supervisorSignoff.declaration ?? null,
      signature: {
        signature: supervisorSignoff.signature ?? null,
        mode: supervisorSignoff.mode ?? null,
        date: supervisorSignoff.date ?? null,
      },
    },
    ims: {
      signature: {
        signature: inspectorSignoff.signature ?? null,
        mode: inspectorSignoff.mode ?? null,
        date: inspectorSignoff.date ?? null,
      },
      declaration: inspectorSignoff.declaration ?? null,
    },
    repair: {
      declaration: repairSignoff.declaration ?? null,
      signature: {
        signature: repairSignoff.signature ?? null,
        mode: repairSignoff.mode ?? null,
        date: repairSignoff.date ?? null,
      },
    },
    document: {
      status: [
        {
          revision: 0,
          documentNumber: workOrder.referenceNumber ?? null,
          preparedBy: supervisor.name || null,
          approvedBy: null as string | null,
          date: { date: dateObj },
        },
      ],
    },
    reviewDate: { date: dateObj },
  };

  // ── ISO 6319:2026 Annex D: zone-level summary aggregation ──────────
  const isoZoneSummary = buildIsoZoneSummary(entries, activeFoulingScale);
  (data as any).isoZoneSummary = isoZoneSummary.hullZones;
  (data as any).isoNicheZoneSummary = isoZoneSummary.nicheZones;
  (data as any).hasIsoZoneData = isoZoneSummary.hasData;
  (data as any).isoVisibility = reportConfig.visibility ?? null;
  (data as any).isoVisibilityLabel = ISO_VISIBILITY_CONDITIONS.find(
    (v) => v.value === reportConfig.visibility
  )?.label ?? reportConfig.visibility ?? null;
  (data as any).afcConditions = ISO_AFC_CONDITIONS;
  (data as any).mgpsConditions = ISO_MGPS_CONDITIONS;

  const pinnedCandidates: Array<{ path: string; keys: string[]; title: string }> = [
    { path: 'ReportCover', keys: ['coverImage', 'coverPhoto', 'reportCover', 'reportCoverImage', 'coverImageMediaId'], title: 'Report Cover' },
    { path: 'ClientLogo', keys: ['clientLogo', 'logo', 'clientLogoImage', 'clientLogoMediaId'], title: 'Client Logo' },
    { path: 'GeneralArrangement', keys: ['generalArrangementImage', 'gaImage', 'gaImageMediaId'], title: 'General Arrangement' },
  ];
  const pinnedAttachments: Array<{ path: string; attachment: unknown; title: string }> = [];
  for (const candidate of pinnedCandidates) {
    const value = pickConfiguredImage(reportConfig, candidate.keys);
    if (value != null) {
      pinnedAttachments.push({ path: candidate.path, attachment: value, title: candidate.title });
    }
  }

  // Flatten sub-entries alongside parents so buildAttachments picks up sub-component photos
  const allEntriesFlat: Array<{ component: string; attachments: unknown }> = [];
  for (const entry of entries) {
    allEntriesFlat.push(entry);
    const subs = (entry as any).subEntries as typeof entries | undefined;
    if (subs) {
      for (const sub of subs) allEntriesFlat.push(sub);
    }
  }

  const attachments = await buildAttachments(allEntriesFlat, pinnedAttachments);

  return {
    data,
    createdBy: { companyName: organisation.name },
    attachments,
    inspectorComments: '',
    _counters: { level1: 0, level2: 0, level3: 0 },
  };
}

/**
 * Build ISO 6319:2026 Annex D zone summary from work form entries.
 * Aggregates findings by ISO zone: highest FR/LoF, most common rating,
 * macrofouling %, worst PDR (coating condition), and cleaning compliance.
 */
export function buildIsoZoneSummary(
  entries: Array<any>,
  foulingScale: FoulingScale
) {
  type ZoneAgg = {
    zoneId: string;
    zoneLabel: string;
    zoneType: 'hull' | 'niche';
    highestRating: number | null;
    highestRatingFormatted: string | null;
    ratings: number[];
    mostCommonRating: number | null;
    mostCommonRatingFormatted: string | null;
    macrofoulingPercent: number | null;
    worstCoatingCondition: string | null;
    entryCount: number;
    cleaningCompliant: boolean; // FR≤1 areas: no capture needed per ISO
  };

  const zoneMap = new Map<string, ZoneAgg>();

  function ensureZone(zoneId: string): ZoneAgg {
    if (zoneMap.has(zoneId)) return zoneMap.get(zoneId)!;
    const isoZ = getIsoZone(zoneId);
    const agg: ZoneAgg = {
      zoneId,
      zoneLabel: isoZ?.label ?? zoneId,
      zoneType: isoZ?.type ?? 'hull',
      highestRating: null,
      highestRatingFormatted: null,
      ratings: [],
      mostCommonRating: null,
      mostCommonRatingFormatted: null,
      macrofoulingPercent: null,
      worstCoatingCondition: null,
      entryCount: 0,
      cleaningCompliant: true,
    };
    zoneMap.set(zoneId, agg);
    return agg;
  }

  // Process all entries (including sub-entries)
  const allEntries: any[] = [];
  for (const entry of entries) {
    allEntries.push(entry);
    if (entry.subEntries) {
      for (const sub of entry.subEntries) allEntries.push(sub);
    }
  }

  for (const e of allEntries) {
    const zoneId = e.isoZone;
    if (!zoneId) continue;

    const agg = ensureZone(zoneId);
    agg.entryCount++;

    if (e.foulingRating != null) {
      agg.ratings.push(e.foulingRating);
      if (agg.highestRating === null || e.foulingRating > agg.highestRating) {
        agg.highestRating = e.foulingRating;
        agg.highestRatingFormatted = formatFoulingValue(e.foulingRating, foulingScale);
      }
    }

    if (e.coverage != null && e.coverage > (agg.macrofoulingPercent ?? 0)) {
      agg.macrofoulingPercent = e.coverage;
    }

    if (e.coatingCondition) {
      // Track worst coating condition (simple: later/longer string wins, or specific ordering)
      if (!agg.worstCoatingCondition || e.coatingCondition > agg.worstCoatingCondition) {
        agg.worstCoatingCondition = e.coatingCondition;
      }
    }

    // Non-capture cleaning compliance: if any entry in a zone has FR>1 (or LoF>1), zone is not compliant
    if (foulingScale === 'LOF' && e.foulingRating != null && e.foulingRating > 1) {
      agg.cleaningCompliant = false;
    }
    if (foulingScale === 'FR' && e.foulingRating != null && e.foulingRating > 10) {
      agg.cleaningCompliant = false;
    }
  }

  // Compute most common rating per zone
  for (const agg of zoneMap.values()) {
    if (agg.ratings.length > 0) {
      const freq = new Map<number, number>();
      for (const r of agg.ratings) freq.set(r, (freq.get(r) ?? 0) + 1);
      let maxCount = 0;
      let mostCommon = agg.ratings[0];
      for (const [val, count] of freq) {
        if (count > maxCount) { maxCount = count; mostCommon = val; }
      }
      agg.mostCommonRating = mostCommon;
      agg.mostCommonRatingFormatted = formatFoulingValue(mostCommon, foulingScale);
    }
  }

  // Split into hull zones and niche zones, maintaining ISO order
  const hullZones: ZoneAgg[] = [];
  for (const hz of ISO_HULL_ZONES) {
    if (zoneMap.has(hz.id)) hullZones.push(zoneMap.get(hz.id)!);
  }
  const nicheZones: ZoneAgg[] = [];
  for (const nz of ISO_NICHE_ZONES) {
    if (zoneMap.has(nz.id)) nicheZones.push(zoneMap.get(nz.id)!);
  }

  return {
    hullZones,
    nicheZones,
    hasData: hullZones.length > 0 || nicheZones.length > 0,
  };
}
