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

type ReportMediaRef = {
  mediaId?: string;
  id?: string;
  url?: string;
  fullApiUrl?: string;
  fullUri?: string;
  path?: string;
  title?: string;
};

type ReportSignoffConfig = {
  name?: string | null;
  declaration?: string | null;
  signature?: string | null;
  mode?: string | null;
  date?: string | null;
};

type ReportConfig = {
  title?: string | null;
  workInstruction?: string | null;
  summary?: string | null;
  overview?: string | null;
  methodology?: string | null;
  recommendations?: string | null;
  visibility?: string | null;
  clientDetails?: string | null;
  buyerName?: string | null;
  reviewerName?: string | null;
  berthAnchorageLocation?: string | null;
  togglePhotoName?: boolean;
  supervisorName?: string | null;
  inspectorName?: string | null;
  confidential?: string | null;
  toggleRovUse?: boolean;
  rovDetails?: string | null;
  repairAgentName?: string | null;
  coverImage?: string | ReportMediaRef | null;
  clientLogo?: string | ReportMediaRef | null;
  generalArrangementImage?: string | ReportMediaRef | null;
  signoff?: {
    supervisor?: ReportSignoffConfig | null;
    inspector?: ReportSignoffConfig | null;
    repair?: ReportSignoffConfig | null;
  } | null;
};

type MediaInfo = {
  url: string;
  originalName: string | null;
  createdAt: Date;
  capturedAt: Date | null;
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
async function buildAttachments(
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
  const unwrapped = unwrapMediaRef(value);
  if (unwrapped !== value) return extractMediaId(unwrapped);
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

function formatTimestampForFilename(value: Date | string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(safeDate.getUTCDate()).padStart(2, '0');
  const hh = String(safeDate.getUTCHours()).padStart(2, '0');
  const min = String(safeDate.getUTCMinutes()).padStart(2, '0');
  const sec = String(safeDate.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${sec}`;
}

function extensionFromName(name: string | null | undefined): string {
  if (!name) return '.jpg';
  const ext = path.extname(name).toLowerCase();
  return ext && ext.length <= 5 ? ext : '.jpg';
}

function buildTimestampFilename(media: MediaInfo): string {
  const stamp = formatTimestampForFilename(media.capturedAt ?? media.createdAt);
  return `IMG_${stamp}${extensionFromName(media.originalName)}`;
}

function parseJsonObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getReportConfig(rawMetadata: unknown): ReportConfig {
  const parsed = parseJsonObject(rawMetadata);
  const reportConfig = parsed.reportConfig && typeof parsed.reportConfig === 'object' ? parsed.reportConfig : {};
  return reportConfig as ReportConfig;
}

function mergeReportConfig(rawMetadata: unknown, reportConfig: ReportConfig): Record<string, unknown> {
  const parsed = parseJsonObject(rawMetadata);
  const existing = getReportConfig(parsed);
  return {
    ...parsed,
    reportConfig: {
      ...existing,
      ...reportConfig,
      signoff: {
        ...(existing.signoff || {}),
        ...(reportConfig.signoff || {}),
        supervisor: {
          ...(existing.signoff?.supervisor || {}),
          ...(reportConfig.signoff?.supervisor || {}),
        },
        inspector: {
          ...(existing.signoff?.inspector || {}),
          ...(reportConfig.signoff?.inspector || {}),
        },
        repair: {
          ...(existing.signoff?.repair || {}),
          ...(reportConfig.signoff?.repair || {}),
        },
      },
    },
  };
}

function unwrapMediaRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object') return obj.data;
  if (obj.media && typeof obj.media === 'object') return obj.media;
  return value;
}

function resolveAttachmentSource(
  source: unknown,
  mediaMap: Map<string, MediaInfo>,
  defaultTitle?: string
): { url: string; idSuffix?: string; title?: string; path?: string } | null {
  const unwrappedSource = unwrapMediaRef(source);
  if (unwrappedSource !== source) {
    return resolveAttachmentSource(unwrappedSource, mediaMap, defaultTitle);
  }

  if (typeof source === 'string') {
    if (isLikelyUrl(source)) {
      return { url: normalizeMediaUrl(source), title: defaultTitle };
    }
    const media = mediaMap.get(source);
    if (!media) return null;
    return {
      url: normalizeMediaUrl(media.url),
      idSuffix: source.slice(0, 8),
      title: buildTimestampFilename(media),
    };
  }

  if (!source || typeof source !== 'object') return null;
  const sourceObj = source as Record<string, unknown>;
  const explicitUrl = [sourceObj.fullApiUrl, sourceObj.fullUri, sourceObj.url]
    .find((v) => typeof v === 'string') as string | undefined;
  if (explicitUrl) {
    return {
      url: normalizeMediaUrl(explicitUrl),
      title: typeof sourceObj.title === 'string' ? sourceObj.title : defaultTitle,
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
    title: typeof sourceObj.title === 'string' ? sourceObj.title : buildTimestampFilename(media),
    path: typeof sourceObj.path === 'string' ? sourceObj.path : undefined,
  };
}

function pickConfiguredImage(config: ReportConfig, keys: string[]): unknown {
  for (const key of keys) {
    const value = (config as any)[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

/** Map form data + photoPages into the report template context (data.*, createdBy, attachments, etc.) */
async function buildInspectionReportContext(
  formData: Awaited<ReturnType<typeof workFormService.getFormDataJson>>,
  photoPages: Array<{ sectionName: string; photos: Array<{ src: string; caption: string }> }>
) {
  const { workOrder, vessel, organisation, team, entries } = formData;
  const reportConfig = getReportConfig((workOrder as any).metadata);
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
  const supervisorSignoff = reportConfig.signoff?.supervisor ?? {};
  const inspectorSignoff = reportConfig.signoff?.inspector ?? {};
  const repairSignoff = reportConfig.signoff?.repair ?? {};

  const data = {
    jobType: workOrder.type || 'Inspection',
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

  const pinnedAttachments = [
    pickConfiguredImage(reportConfig, ['coverImage', 'coverPhoto', 'reportCover', 'reportCoverImage', 'coverImageMediaId'])
      ? { path: 'ReportCover', attachment: pickConfiguredImage(reportConfig, ['coverImage', 'coverPhoto', 'reportCover', 'reportCoverImage', 'coverImageMediaId']), title: 'Report Cover' }
      : null,
    pickConfiguredImage(reportConfig, ['clientLogo', 'logo', 'clientLogoImage', 'clientLogoMediaId'])
      ? { path: 'ClientLogo', attachment: pickConfiguredImage(reportConfig, ['clientLogo', 'logo', 'clientLogoImage', 'clientLogoMediaId']), title: 'Client Logo' }
      : null,
    pickConfiguredImage(reportConfig, ['generalArrangementImage', 'gaImage', 'generalArrangement', 'gaImageMediaId'])
      ? { path: 'GeneralArrangement', attachment: pickConfiguredImage(reportConfig, ['generalArrangementImage', 'gaImage', 'generalArrangement', 'gaImageMediaId']), title: 'General Arrangement' }
      : null,
  ].filter(Boolean) as Array<{ path: string; attachment: unknown; title?: string }>;

  const attachments = await buildAttachments(entries, pinnedAttachments);

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

function buildReportViewerHtml(workOrderId: string): string {
  const safeWorkOrderId = workOrderId.replace(/"/g, '&quot;');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inspection Report Viewer</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; background: #e8ecf1; color: #0f172a; }
      .toolbar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 10;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 10px 16px; background: #ffffff; border-bottom: 1px solid #dbe3ef;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      }
      .title { font-size: 14px; font-weight: 500; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .nav { display: flex; gap: 6px; align-items: center; }
      .actions { display: flex; gap: 6px; align-items: center; }
      button, .linkBtn {
        border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px;
        padding: 6px 12px; font-size: 13px; cursor: pointer; text-decoration: none;
        display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
        transition: background 0.15s, border-color 0.15s;
      }
      button:hover, .linkBtn:hover { background: #f1f5f9; border-color: #94a3b8; }
      button:disabled { opacity: 0.4; cursor: default; }
      button:disabled:hover { background: #fff; border-color: #cbd5e1; }
      button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      button.primary:hover { background: #1d4ed8; }
      .pager { font-size: 13px; color: #475569; min-width: 90px; text-align: center; font-variant-numeric: tabular-nums; }
      .container { padding-top: 60px; height: 100vh; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: 0; background: #e8ecf1; }
      .kbd { font-size: 11px; color: #94a3b8; margin-left: 2px; }
      @media print {
        .toolbar { display: none; }
        .container { padding: 0; height: auto; }
        iframe { height: auto; }
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="title">Inspection Report</div>
      <div class="nav">
        <button id="prevBtn" type="button" title="Previous page (Left arrow)">&#9664; Prev</button>
        <span id="pager" class="pager">Loading...</span>
        <button id="nextBtn" type="button" title="Next page (Right arrow)">Next &#9654;</button>
      </div>
      <div class="actions">
        <button id="printBtn" class="primary" type="button" title="Print or save as PDF (Ctrl+P)">Print / Save PDF</button>
        <a class="linkBtn" href="/api/v1/reports/preview/${safeWorkOrderId}" target="_blank" rel="noreferrer">Open Raw</a>
      </div>
    </div>
    <div class="container">
      <iframe id="reportFrame" src="/api/v1/reports/preview/${safeWorkOrderId}" title="Inspection Report"></iframe>
    </div>
    <script>
      var frame = document.getElementById('reportFrame');
      var pager = document.getElementById('pager');
      var prevBtn = document.getElementById('prevBtn');
      var nextBtn = document.getElementById('nextBtn');
      var printBtn = document.getElementById('printBtn');
      var pages = [];
      var currentIndex = 0;
      var scrollTimeout = null;

      /* Inject A4 screen styles into the iframe content so pages render as distinct A4 cards */
      function injectA4Styles(doc) {
        var style = doc.createElement('style');
        style.setAttribute('data-viewer', 'a4-pages');
        style.textContent = [
          '@media screen {',
          '  html { background: #e8ecf1 !important; }',
          '  body {',
          '    background: transparent !important;',
          '    max-width: none !important;',
          '    width: auto !important;',
          '    padding: 40px 20px !important;',
          '    margin: 0 !important;',
          '    height: auto !important;',
          '    overflow-y: auto !important;',
          '  }',
          '  .page-header { display: none !important; }',
          '  .page-footer, .page-footer-cover { display: none !important; }',
          '  .page-header-space, .page-footer-space { height: 0 !important; display: none !important; }',
          '  .page, .pageLast {',
          '    width: 210mm !important;',
          '    min-height: 297mm !important;',
          '    margin: 0 auto 40px auto !important;',
          '    padding: 20mm 17mm !important;',
          '    background: white !important;',
          '    box-shadow: 0 1px 12px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05) !important;',
          '    border-radius: 2px !important;',
          '    box-sizing: border-box !important;',
          '    position: relative !important;',
          '    page-break-after: unset !important;',
          '  }',
          '}',
        ].join('\\n');
        doc.head.appendChild(style);
      }

      function updatePager() {
        if (!pages.length) { pager.textContent = 'No pages'; return; }
        pager.textContent = 'Page ' + (currentIndex + 1) + ' / ' + pages.length;
        prevBtn.disabled = currentIndex <= 0;
        nextBtn.disabled = currentIndex >= pages.length - 1;
      }

      function goTo(index) {
        if (!pages.length) return;
        currentIndex = Math.max(0, Math.min(index, pages.length - 1));
        var target = pages[currentIndex];
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        updatePager();
      }

      /* Detect current page based on scroll position inside the iframe */
      function onIframeScroll() {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function() {
          var doc = frame.contentDocument;
          if (!doc || !pages.length) return;
          var scrollTop = (doc.documentElement || doc.body).scrollTop;
          var closest = 0;
          var closestDist = Infinity;
          for (var i = 0; i < pages.length; i++) {
            var dist = Math.abs(pages[i].offsetTop - scrollTop - 40);
            if (dist < closestDist) { closestDist = dist; closest = i; }
          }
          if (closest !== currentIndex) {
            currentIndex = closest;
            updatePager();
          }
        }, 80);
      }

      frame.addEventListener('load', function() {
        var doc = frame.contentDocument;
        if (!doc) return;
        injectA4Styles(doc);
        currentIndex = 0;
        pages = Array.from(doc.querySelectorAll('.page, .pageLast')).filter(Boolean);
        updatePager();

        /* Listen for scroll inside iframe to track current page */
        (doc.documentElement || doc.body).addEventListener('scroll', onIframeScroll, { passive: true });
        doc.addEventListener('scroll', onIframeScroll, { passive: true });
      });

      prevBtn.addEventListener('click', function() { goTo(currentIndex - 1); });
      nextBtn.addEventListener('click', function() { goTo(currentIndex + 1); });

      /* Keyboard navigation */
      document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentIndex - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); goTo(currentIndex + 1); }
      });

      printBtn.addEventListener('click', function() {
        if (frame.contentWindow) frame.contentWindow.print();
      });
    </script>
  </body>
</html>`;
}

export const reportService = {
  async getInspectionReportViewHtml(workOrderId: string) {
    return buildReportViewerHtml(workOrderId);
  },

  async getInspectionReportConfig(workOrderId: string) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      select: { id: true, metadata: true },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');
    return getReportConfig(workOrder.metadata);
  },

  async updateInspectionReportConfig(workOrderId: string, reportConfig: ReportConfig) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, isDeleted: false },
      select: { id: true, metadata: true },
    });
    if (!workOrder) throw new AppError(404, 'NOT_FOUND', 'Work order not found');

    const merged = mergeReportConfig(workOrder.metadata, reportConfig);
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { metadata: JSON.stringify(merged) },
    });
    return getReportConfig(merged);
  },

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
