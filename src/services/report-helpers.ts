import path from 'path';
import { env } from '../config/env';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportAttachment = {
  path: string;
  fullApiUrl: string;
  fullUri?: string;
  id?: string;
  title?: string;
};

export type ReportMediaRef = {
  mediaId?: string;
  id?: string;
  url?: string;
  fullApiUrl?: string;
  fullUri?: string;
  path?: string;
  title?: string;
};

export type ReportSignoffConfig = {
  name?: string | null;
  declaration?: string | null;
  signature?: string | null;
  mode?: string | null;
  date?: string | null;
};

export type ReportConfig = {
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

export type MediaInfo = {
  url: string;
  originalName: string | null;
  createdAt: Date;
  capturedAt: Date | null;
};

export type FrRatingDataRow = {
  description: string;
  conditionRating?: string | null;
  levelOfFoulingLoF?: string | null;
  foulingRatingType?: string | null;
  foulingCoverage?: string | null;
  pdrRating?: string | null;
  Comments?: string | null;
  isSubComponent?: boolean;
};

// ── Pure utility functions ───────────────────────────────────────────────────

export function parseAttachmentArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function extractMediaId(value: unknown): string | null {
  const unwrapped = unwrapMediaRef(value);
  if (unwrapped !== value) return extractMediaId(unwrapped);
  if (typeof value === 'string') return isLikelyMediaId(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as any).mediaId ?? (value as any).id;
  return typeof candidate === 'string' && isLikelyMediaId(candidate) ? candidate : null;
}

export function isLikelyMediaId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{16,}$/.test(value) && !isLikelyUrl(value);
}

export function isLikelyUrl(value: string): boolean {
  return /^(https?:\/\/|data:|blob:|\/)/i.test(value);
}

export function normalizeMediaUrl(url: string): string {
  if (!url) return url;
  // Strip legacy baked-in absolute origins (e.g. http://localhost:3001/uploads/x.jpg → /uploads/x.jpg)
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
    } catch { /* not a valid URL, continue */ }
    return url;
  }
  if (url.startsWith('uploads/')) return `/${url}`;
  return url;
}

export function formatTimestampForFilename(value: Date | string | null | undefined): string {
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

export function extensionFromName(name: string | null | undefined): string {
  if (!name) return '.jpg';
  const ext = path.extname(name).toLowerCase();
  return ext && ext.length <= 5 ? ext : '.jpg';
}

export function buildTimestampFilename(media: MediaInfo): string {
  const stamp = formatTimestampForFilename(media.capturedAt ?? media.createdAt);
  return `IMG_${stamp}${extensionFromName(media.originalName)}`;
}

export function parseJsonObject(raw: unknown): Record<string, any> {
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

export function getReportConfig(rawMetadata: unknown): ReportConfig {
  const parsed = parseJsonObject(rawMetadata);
  const reportConfig = parsed.reportConfig && typeof parsed.reportConfig === 'object' ? parsed.reportConfig : {};
  return reportConfig as ReportConfig;
}

export function mergeReportConfig(rawMetadata: unknown, reportConfig: ReportConfig): Record<string, unknown> {
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

export function unwrapMediaRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object') return obj.data;
  if (obj.media && typeof obj.media === 'object') return obj.media;
  return value;
}

export function toAbsoluteMediaUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const apiBase = env.API_URL.replace(/\/+$/, '');
  const normalizedPath = url.startsWith('/') ? url : `/${url}`;
  return `${apiBase}${normalizedPath}`;
}

export function resolveAttachmentSource(
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
      return { url: toAbsoluteMediaUrl(normalizeMediaUrl(source)), title: defaultTitle };
    }
    const media = mediaMap.get(source);
    if (!media) return null;
    return {
      url: toAbsoluteMediaUrl(normalizeMediaUrl(media.url)),
      idSuffix: source.slice(0, 8),
      title: buildTimestampFilename(media),
    };
  }

  if (!source || typeof source !== 'object') return null;
  const sourceObj = source as Record<string, unknown>;

  // Prefer mediaId lookup over explicit URL fields — the media record in DB
  // is the authoritative source and avoids stale/empty URL issues.
  const mediaId = [sourceObj.mediaId, sourceObj.id]
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  if (mediaId) {
    const media = mediaMap.get(mediaId);
    if (media) {
      return {
        url: toAbsoluteMediaUrl(normalizeMediaUrl(media.url)),
        idSuffix: mediaId.slice(0, 8),
        title: typeof sourceObj.title === 'string' ? sourceObj.title : buildTimestampFilename(media),
        path: typeof sourceObj.path === 'string' ? sourceObj.path : undefined,
      };
    }
  }

  // Fall back to explicit URL fields if no mediaId matched a record
  const explicitUrl = [sourceObj.fullApiUrl, sourceObj.fullUri, sourceObj.url]
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  if (explicitUrl) {
    return {
      url: toAbsoluteMediaUrl(normalizeMediaUrl(explicitUrl)),
      title: typeof sourceObj.title === 'string' ? sourceObj.title : defaultTitle,
      path: typeof sourceObj.path === 'string' ? sourceObj.path : undefined,
    };
  }

  return null;
}

export function pickConfiguredImage(config: ReportConfig, keys: string[]): unknown {
  for (const key of keys) {
    const value = (config as any)[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
