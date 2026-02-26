import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import prisma from '../config/database';
import { AppError } from '../middleware/error';
import { workFormService } from './work-form.service';
import { registerReportHelpers } from '../helpers/report-helpers';

// Legacy helpers (kept for any non-report templates)
Handlebars.registerHelper('toLowerCase', (str: string) => str?.toLowerCase() || '');
Handlebars.registerHelper('ifEquals', function (this: any, a: any, b: any, options: any) {
  return a === b ? options.fn(this) : options.inverse(this);
});

const PHOTOS_PER_PAGE = 16; // 2 columns x 8 rows
const REPORT_TEMPLATE_NAME = 'RAN_FUSBiofouling18 (1).hbs';

type ReportAttachment = {
  path: string;
  fullApiUrl: string;
  fullUri?: string;
  id?: string;
  title?: string;
};

type FrRatingDataRow = {
  description: string;
  levelOfFoulingLoF?: string | null;
  foulingRatingType?: string | null;
  foulingCoverage?: string | null;
  pdrRating?: string | null;
  Comments?: string | null;
};

/** Build attachments list for template: path + fullApiUrl per image, keyed by component or special labels */
async function buildAttachments(entries: Array<{ component: string; attachments: unknown }>): Promise<ReportAttachment[]> {
  const list: ReportAttachment[] = [];
  let reportCoverAdded = false;
  const mediaIdSet = new Set<string>();
  const parsedByEntry = new Map<string, unknown[]>();

  for (const entry of entries) {
    const parsed = parseAttachmentArray(entry.attachments);
    parsedByEntry.set(entry.component, parsed);
    for (const value of parsed) {
      const maybeId = extractMediaId(value);
      if (maybeId) mediaIdSet.add(maybeId);
    }
  }

  const mediaMap = new Map<string, { url: string; originalName: string | null }>();
  const mediaIds = Array.from(mediaIdSet);
  if (mediaIds.length > 0) {
    const mediaRecords = await prisma.media.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, url: true, originalName: true },
    });
    for (const media of mediaRecords) {
      mediaMap.set(media.id, { url: media.url, originalName: media.originalName });
    }
  }

  for (const entry of entries) {
    const sourceItems = parsedByEntry.get(entry.component) ?? [];
    const componentPath = (entry.component || '').trim();
    const slug = componentPath.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '') || 'section';
    let index = 0;

    for (const sourceItem of sourceItems) {
      const resolved = resolveAttachmentSource(sourceItem, mediaMap);
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

function parseAttachmentArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractMediaId(value: unknown): string | null {
  if (typeof value === 'string') return isLikelyMediaId(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as any).mediaId ?? (value as any).id;
  return typeof candidate === 'string' && isLikelyMediaId(candidate) ? candidate : null;
}

function isLikelyMediaId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{16,}$/.test(value) && !isLikelyUrl(value);
}

function isLikelyUrl(value: string): boolean {
  return /^(https?:\/\/|data:|blob:|\/)/i.test(value);
}

function normalizeMediaUrl(url: string): string {
  if (!url) return url;
  if (isLikelyUrl(url)) return url;
  if (url.startsWith('uploads/')) return `/${url}`;
  return url;
}

function resolveAttachmentSource(
  source: unknown,
  mediaMap: Map<string, { url: string; originalName: string | null }>
): { url: string; idSuffix?: string; title?: string; path?: string } | null {
  if (typeof source === 'string') {
    if (isLikelyUrl(source)) {
      return { url: normalizeMediaUrl(source) };
    }
    const media = mediaMap.get(source);
    if (!media) return null;
    return {
      url: normalizeMediaUrl(media.url),
      idSuffix: source.slice(0, 8),
      title: media.originalName ?? undefined,
    };
  }

  if (!source || typeof source !== 'object') return null;
  const sourceObj = source as Record<string, unknown>;
  const explicitUrl = [sourceObj.fullApiUrl, sourceObj.fullUri, sourceObj.url]
    .find((v) => typeof v === 'string') as string | undefined;
  if (explicitUrl) {
    return {
      url: normalizeMediaUrl(explicitUrl),
      title: typeof sourceObj.title === 'string' ? sourceObj.title : undefined,
      path: typeof sourceObj.path === 'string' ? sourceObj.path : undefined,
    };
  }

  const mediaId = [sourceObj.mediaId, sourceObj.id].find((v) => typeof v === 'string') as string | undefined;
  if (!mediaId) return null;
  const media = mediaMap.get(mediaId);
  if (!media) return null;
  return {
    url: normalizeMediaUrl(media.url),
    idSuffix: mediaId.slice(0, 8),
    title: typeof sourceObj.title === 'string' ? sourceObj.title : media.originalName ?? undefined,
    path: typeof sourceObj.path === 'string' ? sourceObj.path : undefined,
  };
}

/** Map form data + photoPages into the report template context (data.*, createdBy, attachments, etc.) */
async function buildInspectionReportContext(
  formData: Awaited<ReturnType<typeof workFormService.getFormDataJson>>,
  photoPages: Array<{ sectionName: string; photos: Array<{ src: string; caption: string }> }>
) {
  const { workOrder, vessel, organisation, team, entries } = formData;
  const inspectionDate = workOrder.actualStart ?? workOrder.actualEnd ?? workOrder.scheduledStart ?? new Date();
  const dateObj = inspectionDate instanceof Date ? inspectionDate : new Date(inspectionDate);

  // generalArrangement: one block per entry, with frRatingData for template tables (never empty so TOC safe)
  const generalArrangement = entries.length === 0
    ? [{ id: '', name: '—', diverSupervisorComments: '', expertInspectorComments: '', frRatingData: [{}], comments: '' }]
    : entries.map((entry) => {
    const hasLoF = workOrder.type?.toLowerCase().includes('biofouling') || workOrder.type === 'NZ CRMS Biofouling Inspection';
    const frRatingData: FrRatingDataRow[] = [];
    const desc = entry.component || 'No description';
    if (hasLoF && (entry.foulingRating != null || entry.notes || entry.coatingCondition)) {
      frRatingData.push({
        description: desc,
        levelOfFoulingLoF: entry.foulingRating != null ? `Rank: ${entry.foulingRating}` : null,
        pdrRating: entry.coatingCondition ?? null,
        Comments: entry.notes ?? null,
      });
    } else if (entry.foulingRating != null || entry.foulingType || entry.coverage != null || entry.coatingCondition || entry.notes) {
      frRatingData.push({
        description: desc,
        foulingRatingType: entry.foulingType ?? null,
        foulingCoverage: entry.coverage != null ? `${entry.coverage}%` : null,
        pdrRating: entry.coatingCondition ?? null,
        Comments: entry.notes ?? null,
      });
    }

    const diverSupervisorComments = entry.notes ? `<p>${escapeHtml(String(entry.notes))}</p>` : '';
    const expertInspectorComments = entry.recommendation ? `<p>${escapeHtml(String(entry.recommendation))}</p>` : '';
    const comments = [entry.notes, entry.recommendation].filter(Boolean).join(' ') || '';

    return {
      id: (entry as any).id ?? entry.component?.replace(/\s+/g, '-') ?? '',
      name: entry.component || 'Section',
      diverSupervisorComments,
      expertInspectorComments,
      frRatingData: frRatingData.length ? frRatingData : [{ description: desc, levelOfFoulingLoF: null, foulingRatingType: null, foulingCoverage: null, pdrRating: null, Comments: null }],
      comments,
    };
  });

  const supervisor = team && team.length > 0 ? { name: team[0].name } : { name: '' };
  const divers = team?.filter((t) => (t as any).role?.toLowerCase?.().includes('diver'))?.map((t) => ({ diverName: t.name })) ?? [];
  const inspector = team?.length ? { name: team[team.length - 1].name } : { name: '' };

  const data = {
    jobType: workOrder.type || 'Inspection',
    supportingWork: workOrder.title || '',
    confidential: null as string | null,
    workInstruction: workOrder.description || null,
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
      summary: null as string | null,
      overview: null as string | null,
      methodology: null as string | null,
      recommendations: null as string | null,
    },
    visibility: null as string | null,
    clientDetails: null as string | null,
    invites: {
      buyer: [{ name: null as string | null }],
      reviewerName: null as string | null,
    },
    location: {
      data: { displayName: workOrder.location ?? null },
      displayName: workOrder.location ?? null,
    },
    berthAnchorageLocation: workOrder.location ?? '',
    supervisor,
    resourcing: { toggleRovUse: null as string | null, rovDetails: null as string | null },
    repairAgent: { name: null as string | null },
    inspector,
    divers,
    inspectionType: workOrder.type || 'Inspection',
    togglePhotoName: { checked: false },
    diveSupervisor: { declaration: null as string | null, signature: { signature: null as string | null, mode: null as string | null, date: null as string | null } },
    ims: { signature: { signature: null as string | null, mode: null as string | null, date: null as string | null }, declaration: null as string | null },
    repair: { declaration: null as string | null, signature: { signature: null as string | null, mode: null as string | null, date: null as string | null } },
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

  const attachments = await buildAttachments(entries);

  return {
    data,
    createdBy: { companyName: organisation.name },
    attachments,
    inspectorComments: '',
    _counters: { level1: 0, level2: 0, level3: 0 },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPhotoPages(entries: Array<{ component: string; attachments: unknown }>) {
  const photoPages: Array<{ sectionName: string; photos: Array<{ src: string; caption: string }> }> = [];

  for (const entry of entries) {
    let attachments: string[] = [];
    try {
      attachments = typeof entry.attachments === 'string' ? JSON.parse(entry.attachments) : (entry.attachments || []);
    } catch { /* ignore */ }

    if (attachments.length === 0) continue;

    const photos = attachments.map((src: string, i: number) => ({
      src,
      caption: `${entry.component} - Photo ${i + 1}`,
    }));

    for (let i = 0; i < photos.length; i += PHOTOS_PER_PAGE) {
      photoPages.push({
        sectionName: entry.component,
        photos: photos.slice(i, i + PHOTOS_PER_PAGE),
      });
    }
  }

  return photoPages;
}

function resolveInspectionTemplatePath(): string | null {
  const templateCandidates = [
    path.join(__dirname, '..', '..', 'reportTemplates', REPORT_TEMPLATE_NAME),
    path.join(process.cwd(), 'reportTemplates', REPORT_TEMPLATE_NAME),
    path.join(__dirname, '..', '..', 'templates', 'inspection-report.html'),
  ];
  return templateCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export const reportService = {
  async getInspectionReportContext(workOrderId: string) {
    const formData = await workFormService.getFormDataJson(workOrderId);
    const photoPages = buildPhotoPages(formData.entries);
    const context = await buildInspectionReportContext(formData, photoPages);

    return {
      workOrderId,
      templatePath: resolveInspectionTemplatePath(),
      formData,
      photoPages,
      context,
    };
  },

  async generateInspectionReport(workOrderId: string) {
    const formData = await workFormService.getFormDataJson(workOrderId);
    const photoPages = buildPhotoPages(formData.entries);
    const templatePath = resolveInspectionTemplatePath();
    if (!templatePath) return { ...formData, photoPages, html: null };

    const templateSource = fs.readFileSync(templatePath, 'utf-8');

    registerReportHelpers(Handlebars);
    const template = Handlebars.compile(templateSource);
    const context = await buildInspectionReportContext(formData, photoPages);
    const html = template(context);

    return {
      ...formData,
      photoPages,
      html,
    };
  },

  async generateWorkOrderReport(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      include: {
        vessel: true,
        organisation: true,
        assignments: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        inspections: { include: { findings: true } },
        taskSubmissions: { include: { task: true, user: { select: { firstName: true, lastName: true } } } },
        comments: { include: { author: { select: { firstName: true, lastName: true } } } },
        formEntries: { include: { vesselComponent: true } },
      },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    return workOrder;
  },

  async getDocuments(filters: { vesselId?: string; workOrderId?: string } = {}, organisationId?: string) {
    const where: any = {};
    if (filters?.vesselId) where.vesselId = filters.vesselId;
    if (filters?.workOrderId) where.workOrderId = filters.workOrderId;
    if (organisationId) {
      where.OR = [
        { workOrder: { organisationId, isDeleted: false } },
        { vessel: { organisationId, isDeleted: false } },
      ];
    }

    return prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  },
};
