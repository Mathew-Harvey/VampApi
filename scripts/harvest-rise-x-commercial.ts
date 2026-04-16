import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Json = Record<string, unknown>;

type FlowDef = {
  flowType?: string;
  displayName?: string;
  entityType?: string;
};

type WorkRow = {
  id?: string;
  workCode?: string;
  flowType?: string;
  flowOriginId?: string;
  displayName?: string;
  [key: string]: unknown;
};

type Attachment = {
  attachmentId?: string;
  id?: string;
  fileType?: string;
  unsafeOriginalFileName?: string;
  path?: string;
  fullUri?: string;
};

const API_BASE = (process.env.RISE_X_API_URL || 'https://api-test.rise-x.io').replace(/\/+$/, '');
const BEARER_TOKEN = process.env.RISE_X_BEARER_TOKEN || '';
const API_KEY = process.env.RISE_X_API_KEY || '';

const HARVEST_DIR = path.join(process.cwd(), 'rise-x-harvest');
const WORK_DETAILS_DIR = path.join(HARVEST_DIR, 'work-details');
const IMAGES_DIR = path.join(HARVEST_DIR, 'images');
const FLOWS_PATH = path.join(HARVEST_DIR, 'flows.json');

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`;
  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
    if (!headers.Authorization) headers.Authorization = `Bearer ${API_KEY}`;
  }
  return headers;
}

function sanitizeSegment(input: string | undefined): string {
  const value = (input || 'unknown').trim();
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim() || 'unknown';
}

function isCommercialFlowType(flowType: string | undefined): boolean {
  const f = (flowType || '').toLowerCase();
  if (!f.includes('/vessel/')) return false;
  return !f.includes('/ranvessel/') && !f.includes('/royalnavyvessel/') && !f.includes('/usnvessel/') && !f.includes('/rnznvessel/');
}

function pickRows(data: unknown): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.rows)) return d.rows as Json[];
    if (Array.isArray(d.data)) return d.data as Json[];
    if (Array.isArray(d.items)) return d.items as Json[];
    if (d.data && typeof d.data === 'object') {
      const inner = d.data as Record<string, unknown>;
      if (Array.isArray(inner.rows)) return inner.rows as Json[];
      if (Array.isArray(inner.items)) return inner.items as Json[];
    }
  }
  return [];
}

async function callJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchPagedRows(endpoint: string, flowOriginIds: string[], label: string): Promise<Json[]> {
  const all: Json[] = [];
  let skip = 0;
  const take = 100;

  while (true) {
    const payload = {
      filterProperties: [],
      flowOriginIds,
      additionalProperties: [],
      skip,
      take,
      activeStepIds: [],
      customViewQueries: [],
    };

    const data = await callJson(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    const rows = pickRows(data);
    all.push(...rows);

    console.log(`  ${label}: fetched ${rows.length} rows (skip=${skip})`);
    if (rows.length < take) break;
    skip += take;
  }

  return all;
}

function getCommercialFlowOrigins(flows: Record<string, FlowDef>) {
  const assetFlowIds: string[] = [];
  const workFlowIds: string[] = [];

  for (const [flowOriginId, def] of Object.entries(flows)) {
    const flowType = def.flowType || '';
    if (!isCommercialFlowType(flowType)) continue;

    if (flowType.endsWith('/assets')) {
      assetFlowIds.push(flowOriginId);
    } else {
      workFlowIds.push(flowOriginId);
    }
  }

  return { assetFlowIds, workFlowIds };
}

async function downloadAttachment(att: Attachment, workCode: string): Promise<boolean> {
  if (!att.fullUri) return false;

  const originalName = sanitizeSegment(att.unsafeOriginalFileName || `${att.attachmentId || att.id || 'file'}.jpg`);
  const section = sanitizeSegment(att.path || 'unclassified');
  const targetDir = path.join(IMAGES_DIR, workCode, section);
  await fsp.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, originalName);

  if (fs.existsSync(targetPath)) return false;

  const url = att.fullUri.startsWith('http') ? att.fullUri : `${API_BASE}${att.fullUri}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);

  const arrayBuffer = await res.arrayBuffer();
  await fsp.writeFile(targetPath, Buffer.from(arrayBuffer));
  return true;
}

async function main() {
  console.log('Rise-X Commercial Harvest');
  console.log('=========================\n');

  if (!BEARER_TOKEN && !API_KEY) {
    throw new Error('Missing Rise-X token. Set RISE_X_BEARER_TOKEN (or RISE_X_API_KEY) in .env before running.');
  }

  await fsp.mkdir(HARVEST_DIR, { recursive: true });
  await fsp.mkdir(WORK_DETAILS_DIR, { recursive: true });
  await fsp.mkdir(IMAGES_DIR, { recursive: true });

  if (!fs.existsSync(FLOWS_PATH)) {
    throw new Error(`Missing ${FLOWS_PATH}. Run flow harvest first or place flows.json in rise-x-harvest/.`);
  }

  const flows = JSON.parse(await fsp.readFile(FLOWS_PATH, 'utf8')) as Record<string, FlowDef>;
  const { assetFlowIds, workFlowIds } = getCommercialFlowOrigins(flows);

  if (assetFlowIds.length === 0 && workFlowIds.length === 0) {
    throw new Error('No commercial flow origins found in flows.json');
  }

  console.log(`Commercial asset flow origins: ${assetFlowIds.length}`);
  console.log(`Commercial work flow origins:  ${workFlowIds.length}\n`);

  const assets = assetFlowIds.length
    ? await fetchPagedRows('/api/v3/data-grid/asset-rows', assetFlowIds, 'asset-rows')
    : [];
  const workRowsRaw = workFlowIds.length
    ? await fetchPagedRows('/api/v3/data-grid/work-rows', workFlowIds, 'work-rows')
    : [];

  const commercialWorkOrigins = new Set(workFlowIds);
  const workRows = workRowsRaw
    .map((r) => r as unknown as WorkRow)
    .filter((r) => {
      if (!r.id) return false;
      // Some data-grid rows return flowType as null; flowOriginId is reliable.
      if (r.flowOriginId && commercialWorkOrigins.has(r.flowOriginId)) return true;
      // Fallback for older payloads where only flowType is present.
      return isCommercialFlowType(r.flowType);
    });

  const dedupedWorkRows = Array.from(
    new Map(workRows.map((r) => [r.id as string, r])).values(),
  );

  console.log(`\nCommercial assets found: ${assets.length}`);
  console.log(`Commercial work rows found: ${dedupedWorkRows.length}`);

  const now = new Date().toISOString();
  await fsp.writeFile(
    path.join(HARVEST_DIR, 'assets-commercial.json'),
    JSON.stringify({ harvestedAt: now, count: assets.length, rows: assets }, null, 2),
    'utf8',
  );
  await fsp.writeFile(
    path.join(HARVEST_DIR, 'work-open-commercialWorkboard.ndjson'),
    dedupedWorkRows.map((r) => JSON.stringify(r)).join('\n'),
    'utf8',
  );

  let detailsFetched = 0;
  let detailsFailed = 0;
  let photosDownloaded = 0;
  let photoErrors = 0;

  for (const row of dedupedWorkRows) {
    const workId = row.id as string;
    const workCode = sanitizeSegment(row.workCode || workId);
    const outPath = path.join(WORK_DETAILS_DIR, `${workCode}.json`);

    let detail: Json;
    try {
      const data = await callJson(`${API_BASE}/api/v3/work/${workId}`, {
        method: 'GET',
        headers: authHeaders(),
      });
      detail = data as Json;
      detailsFetched++;
      await fsp.writeFile(outPath, JSON.stringify(detail, null, 2), 'utf8');
      console.log(`  Detail: ${workCode}`);
    } catch (error: any) {
      detailsFailed++;
      console.log(`  Detail ERROR ${workCode}: ${error.message}`);
      continue;
    }

    const attachments = Array.isArray(detail.attachments) ? (detail.attachments as Attachment[]) : [];
    const imageAttachments = attachments.filter((a) => {
      const ext = (a.fileType || '').toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });

    for (const att of imageAttachments) {
      try {
        const downloaded = await downloadAttachment(att, workCode);
        if (downloaded) photosDownloaded++;
      } catch (error: any) {
        photoErrors++;
        const attId = att.attachmentId || att.id || 'unknown';
        console.log(`    Photo ERROR ${workCode}/${attId}: ${error.message}`);
      }
    }
  }

  const summary = {
    harvestedAt: now,
    apiBase: API_BASE,
    commercialAssetFlows: assetFlowIds,
    commercialWorkFlows: workFlowIds,
    assetsFound: assets.length,
    workRowsFound: dedupedWorkRows.length,
    workDetailsFetched: detailsFetched,
    workDetailsErrors: detailsFailed,
    photosDownloaded,
    photoErrors,
  };

  await fsp.writeFile(
    path.join(HARVEST_DIR, 'harvest-commercial-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );

  console.log('\n=========================');
  console.log('Commercial Harvest Summary');
  console.log('=========================');
  console.log(`Assets found:       ${summary.assetsFound}`);
  console.log(`Work rows found:    ${summary.workRowsFound}`);
  console.log(`Work details saved: ${summary.workDetailsFetched}`);
  console.log(`Detail errors:      ${summary.workDetailsErrors}`);
  console.log(`Photos downloaded:  ${summary.photosDownloaded}`);
  console.log(`Photo errors:       ${summary.photoErrors}`);
}

main().catch((error) => {
  console.error('Fatal:', error.message);
  process.exit(1);
});
