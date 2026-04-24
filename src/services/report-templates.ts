import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { registerReportHelpers } from '../helpers/report-helpers';
import { toAbsoluteMediaUrl, normalizeMediaUrl } from './report-helpers';

// Legacy helpers (kept for any non-report templates)
Handlebars.registerHelper('toLowerCase', (str: string) => str?.toLowerCase() || '');
Handlebars.registerHelper('ifEquals', function (this: any, a: any, b: any, options: any) {
  return a === b ? options.fn(this) : options.inverse(this);
});

export const PHOTOS_PER_PAGE = 16; // 2 columns x 8 rows
export const REPORT_TEMPLATE_NAME = 'RAN_FUSBiofouling18 (1).hbs';
export const BFMP_TEMPLATE_NAME = 'bfmp-report.hbs';
export const COMPLIANCE_TEMPLATE_NAME = 'compliance-report.hbs';
export const AUDIT_TEMPLATE_NAME = 'audit-report.hbs';
export const WORK_ORDER_TEMPLATE_NAME = 'work-order-report.hbs';
export const RECORD_BOOK_TEMPLATE_NAME = 'record-book-report.hbs';

export function resolveInspectionTemplatePath(): string | null {
  const templateCandidates = [
    path.join(__dirname, '..', '..', 'reportTemplates', REPORT_TEMPLATE_NAME),
    path.join(process.cwd(), 'reportTemplates', REPORT_TEMPLATE_NAME),
    path.join(__dirname, '..', '..', 'templates', 'inspection-report.html'),
  ];
  return templateCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function resolveTemplatePath(templateName: string): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'reportTemplates', templateName),
    path.join(process.cwd(), 'reportTemplates', templateName),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function compileAndRender(templateName: string, context: Record<string, any>): string | null {
  const templatePath = resolveTemplatePath(templateName);
  if (!templatePath) return null;
  const source = fs.readFileSync(templatePath, 'utf-8');
  registerReportHelpers(Handlebars);
  // Register helpers needed by the new templates
  if (!Handlebars.helpers['lowercase']) {
    Handlebars.registerHelper('lowercase', (str: string) => {
      if (!str || typeof str !== 'string') return '';
      return str.toLowerCase().replace(/\s+/g, '');
    });
  }
  if (!Handlebars.helpers['truncateId']) {
    Handlebars.registerHelper('truncateId', (id: string) => {
      if (!id || typeof id !== 'string') return '';
      return id.length > 8 ? id.slice(0, 8) + '...' : id;
    });
  }
  if (!Handlebars.helpers['gte']) {
    Handlebars.registerHelper('gte', (a: any, b: any) => Number(a) >= Number(b));
  }
  if (!Handlebars.helpers['statusBadge']) {
    Handlebars.registerHelper('statusBadge', (status: string) => {
      if (!status) return 'badge-gray';
      const s = status.toUpperCase();
      if (s === 'COMPLETED' || s === 'APPROVED' || s === 'ACTIVE') return 'badge-green';
      if (s === 'IN_PROGRESS' || s === 'PENDING' || s === 'OPEN' || s === 'SUBMITTED') return 'badge-blue';
      if (s === 'OVERDUE' || s === 'REJECTED' || s === 'CANCELLED') return 'badge-red';
      if (s === 'DRAFT' || s === 'SCHEDULED') return 'badge-amber';
      return 'badge-gray';
    });
  }
  if (!Handlebars.helpers['severityBadge']) {
    Handlebars.registerHelper('severityBadge', (severity: string) => {
      if (!severity) return 'badge-gray';
      const s = severity.toUpperCase();
      if (s === 'CRITICAL' || s === 'HIGH') return 'badge-red';
      if (s === 'MEDIUM' || s === 'MODERATE') return 'badge-amber';
      if (s === 'LOW' || s === 'MINOR') return 'badge-green';
      return 'badge-gray';
    });
  }
  if (!Handlebars.helpers['isEven']) {
    Handlebars.registerHelper('isEven', (index: number) => index % 2 === 0);
  }
  if (!Handlebars.helpers['isOdd']) {
    Handlebars.registerHelper('isOdd', (index: number) => index % 2 !== 0);
  }
  const template = Handlebars.compile(source);
  return template(context);
}

export function buildPhotoPages(entries: Array<{ component: string; attachments: unknown }>) {
  const photoPages: Array<{ sectionName: string; photos: Array<{ src: string; caption: string }> }> = [];

  for (const entry of entries) {
    let rawAttachments: unknown[] = [];
    try {
      rawAttachments = typeof entry.attachments === 'string'
        ? JSON.parse(entry.attachments)
        : Array.isArray(entry.attachments) ? entry.attachments : [];
    } catch { /* ignore */ }

    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) continue;

    // Only server-hosted URL attachments can be rendered by the server-side
    // report pipeline. Client-local attachments (photos on a user's laptop)
    // are skipped here and handled by the browser renderer instead.
    const urlStrings: string[] = [];
    for (const att of rawAttachments) {
      if (typeof att === 'string' && att) {
        urlStrings.push(att);
      } else if (att && typeof att === 'object') {
        const obj = att as Record<string, unknown>;
        if (obj.kind === 'url' && typeof obj.url === 'string' && obj.url) {
          urlStrings.push(obj.url);
        }
        // clientLocal entries: silently skipped in server-rendered reports.
      }
    }

    if (urlStrings.length === 0) continue;

    const photos = urlStrings.map((src, i) => ({
      src: toAbsoluteMediaUrl(normalizeMediaUrl(src)),
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

export function buildReportViewerHtml(workOrderId: string, reportType: string = 'inspection', title: string = 'Inspection Report', token?: string): string {
  const safeWorkOrderId = workOrderId.replace(/"/g, '&quot;');
  const safeType = reportType.replace(/"/g, '&quot;');
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const params = new URLSearchParams();
  if (safeType !== 'inspection') params.set('type', safeType);
  if (token) params.set('token', token);
  const qs = params.toString();
  const typeParam = qs ? `?${qs}` : '';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} Viewer</title>
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
      <div class="title">${safeTitle}</div>
      <div class="nav">
        <button id="prevBtn" type="button" title="Previous page (Left arrow)">&#9664; Prev</button>
        <span id="pager" class="pager">Loading...</span>
        <button id="nextBtn" type="button" title="Next page (Right arrow)">Next &#9654;</button>
      </div>
      <div class="actions">
        <button id="printBtn" class="primary" type="button" title="Print or save as PDF (Ctrl+P)">Print / Save PDF</button>
        <a class="linkBtn" href="/api/v1/reports/preview/${safeWorkOrderId}${typeParam}" target="_blank" rel="noreferrer">Open Raw</a>
      </div>
    </div>
    <div class="container">
      <iframe id="reportFrame" src="/api/v1/reports/preview/${safeWorkOrderId}${typeParam}" title="Inspection Report"></iframe>
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
