import Handlebars from 'handlebars';
import moment from 'moment';

// ---------------------------------------------------------------------------
// Counter state (mutated during a single template render)
// ---------------------------------------------------------------------------
function getCounters(options: Handlebars.HelperOptions): { level1: number; level2: number; level3: number } {
  const root = options.data?.root as Record<string, unknown> | undefined;
  if (!root) return { level1: 0, level2: 0, level3: 0 };
  if (!root._counters || typeof (root._counters as any).level1 !== 'number') {
    (root as any)._counters = { level1: 0, level2: 0, level3: 0 };
  }
  return (root as any)._counters;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------
const stringHelpers: Record<string, Handlebars.HelperDelegate> = {
  formatCase: (text: unknown, caseType: string) => {
    if (typeof text !== 'string') return text;
    return caseType === 'upper' ? text.toUpperCase() : caseType === 'lower' ? text.toLowerCase() : text;
  },
  replace: (text: unknown, searchRegex: string, replaceWith: string) => {
    if (typeof text !== 'string') return text;
    return text.replace(new RegExp(searchRegex, 'g'), replaceWith);
  },
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const dateHelpers: Record<string, Handlebars.HelperDelegate> = {
  formatDate: (date: unknown, format: string, timezoneType = 'utc') => {
    if (!date) return '';
    const d = (date as any)?.date ?? date;
    const momentDate = moment(d).utcOffset((date as any)?.offset ?? 0);
    switch (timezoneType) {
      case 'local':
        return momentDate.local().format(format);
      case 'saved':
        return momentDate.format(format);
      default:
        return momentDate.utc().format(format);
    }
  },
  dateDiff: (date1: unknown, date2: unknown, unit: string) => {
    const diff = new Date(date2 as string).getTime() - new Date(date1 as string).getTime();
    switch (unit) {
      case 'm':
        return diff / (60 * 1000);
      case 'h':
        return diff / (60 * 60 * 1000);
      case 'd':
        return Math.floor(diff / (24 * 60 * 60 * 1000));
      default:
        return diff;
    }
  },
  now: (format = 'ddd DD, MMM YYYY') => moment().format(format),
  formatDayOfWeek: (date: unknown) => {
    if (!date) return '';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date((date as any)?.date ?? date).getDay()];
  },
  formatDateTime: (dateTime: unknown, format: string) => {
    if (!dateTime) return '';
    const d = (dateTime as any)?.date ?? dateTime;
    return moment(d).local().format(format);
  },
  todaysDate: () => moment().format('dddd DD MMMM YYYY'),
};

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
const valueHelpers: Record<string, Handlebars.HelperDelegate> = {
  hasValue: (value: unknown) => {
    return !(value == null || value === '<p></p>\n' || value === '');
  },
  ifn: (value: unknown, defaultValue: unknown) => (value == null ? defaultValue : value),
  lookAtMultiValue: (values: unknown) => {
    if (!Array.isArray(values)) return false;
    return values.some((val) => val != null && val !== '<p></p>\n' && val !== '');
  },
  ifValue: (value: unknown, trueResult: unknown, falseResult: unknown) => {
    const v = typeof value === 'string' ? value.toLowerCase() : value;
    if (v === true || v === 1 || v === 'true' || v === 'yes') return trueResult;
    if (v === false || v === 0 || v === 'false' || v === 'no') return falseResult;
    return value != null ? trueResult : falseResult;
  },
  ifValueBool: (value: unknown, trueResult: unknown, falseResult: unknown) => {
    const v = typeof value === 'string' ? value.toLowerCase() : value;
    if (['true', 'yes', '1', 'on'].includes(v as string) || v === true || v === 1) return trueResult;
    if (['false', 'no', '0', 'off'].includes(v as string) || v === false || v === 0) return falseResult;
    return value != null ? trueResult : falseResult;
  },
};

// ---------------------------------------------------------------------------
// Math / comparison helpers
// ---------------------------------------------------------------------------
const mathHelpers: Record<string, Handlebars.HelperDelegate> = {
  sum: (array: unknown[], key: string) => {
    try {
      if (array && Array.isArray(array) && array.length > 0) {
        return array.reduce((sum, item) => sum + ((item as any)?.[key] ?? 0), 0);
      }
    } catch {
      /* noop */
    }
    return 0;
  },
  toDecimalPlaces: (number: unknown, places: number) => {
    const num = Number(number);
    return isNaN(num) ? 0 : num.toFixed(places);
  },
  increment: (value: unknown) => (value != null ? Number(value) : 0) + 1,
  addOne: (index: number) => index + 1,
  eq: (a: unknown, b: unknown) => a === b,
  ifMatch: (value: unknown, matchString: string) => value === matchString,
};

// ---------------------------------------------------------------------------
// Counter helpers (used by TOC and section numbering)
// ---------------------------------------------------------------------------
const counterHelpers: Record<string, Handlebars.HelperDelegate> = {
  resetLevelOneCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level1 = 0;
    return '';
  },
  incrementLevelOneCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level1 += 1;
    return '';
  },
  getLevelOneCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    return getCounters(options).level1;
  },
  resetLevelTwoCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level2 = 0;
    return '';
  },
  incrementLevelTwoCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level2 += 1;
    return '';
  },
  getLevelTwoCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    return getCounters(options).level2;
  },
  resetLevelThreeCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level3 = 0;
    return '';
  },
  incrementLevelThreeCounter: function (this: unknown, options: Handlebars.HelperOptions) {
    getCounters(options).level3 += 1;
    return '';
  },
};

// ---------------------------------------------------------------------------
// Array / attachment helpers
// ---------------------------------------------------------------------------
function arrayHelper(this: unknown, ...args: unknown[]) {
  return Array.prototype.slice.call(args, 0, -1);
}

function findAttachmentByPath(attachments: unknown[] | null, path: string) {
  if (!attachments || !Array.isArray(attachments)) return null;
  return attachments.find((a: any) => a.path === path) ?? null;
}

function getImages(this: unknown, path: string, attachments: unknown[] | null, options: Handlebars.HelperOptions) {
  if (!attachments || !Array.isArray(attachments)) return '';
  const attachmentPath = (path ?? '').replaceAll(' ', '').toLowerCase();
  const matching = attachments.filter(
    (x: any) => (x?.path ?? '').replaceAll(' ', '').toLowerCase() === attachmentPath
  );
  if (!options.fn) return '';
  return matching.map((attachment: any) => options.fn!(attachment, { data: options.data })).join('');
}

function getImagesConditional(
  this: unknown,
  name: string,
  attachments: unknown[] | null,
  options: Handlebars.HelperOptions
) {
  if (!attachments || !Array.isArray(attachments) || name == null) return '';
  const normalizedName = String(name)
    .replaceAll(' ', '')
    .replaceAll('-', '')
    .toLowerCase();
  const matching = attachments.filter((attachment: any) => {
    if (!attachment?.path) return false;
    const normalizedPath = (attachment.path as string).replaceAll(' ', '').replaceAll('-', '').toLowerCase();
    if (normalizedPath === normalizedName) return true;
    if (normalizedName.startsWith(normalizedPath) || normalizedPath.startsWith(normalizedName)) return true;
    if (normalizedPath.includes(normalizedName) || normalizedName.includes(normalizedPath)) return true;
    if (normalizedName.includes('bilgekeels') && normalizedPath.includes('bilgekeels')) return true;
    if (normalizedName.includes('seachest') && normalizedPath.includes('seachest')) return true;
    return false;
  });
  const localImages = matching.filter((a: any) => a.fullUri?.startsWith?.('/images/'));
  const finalList = localImages.length > 0 ? localImages : matching;
  if (finalList.length === 0) return '';
  return finalList
    .map((attachment: any) => {
      if (!attachment.fullApiUrl && attachment.fullUri) attachment.fullApiUrl = attachment.fullUri;
      return options.fn!(attachment, { data: options.data });
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------
function sectionCounter(this: unknown, context: string[], options: Handlebars.HelperOptions) {
  const counts: Record<string, number> = {};
  for (let i = 0; i < context.length; i++) {
    const sectionName = context[i];
    counts[sectionName] = (counts[sectionName] ?? 0) + 1;
  }
  let out = '';
  for (const section of Object.keys(counts)) {
    out += options.fn!({ section, count: counts[section] }, { data: options.data });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Register all helpers with Handlebars
// ---------------------------------------------------------------------------
export function registerReportHelpers(h: typeof Handlebars) {
  Object.entries(stringHelpers).forEach(([name, fn]) => h.registerHelper(name, fn));
  Object.entries(dateHelpers).forEach(([name, fn]) => h.registerHelper(name, fn));
  Object.entries(valueHelpers).forEach(([name, fn]) => h.registerHelper(name, fn));
  Object.entries(mathHelpers).forEach(([name, fn]) => h.registerHelper(name, fn));
  Object.entries(counterHelpers).forEach(([name, fn]) => h.registerHelper(name, fn));
  h.registerHelper('array', arrayHelper);
  h.registerHelper('findAttachmentByPath', findAttachmentByPath);
  h.registerHelper('getImages', getImages);
  h.registerHelper('getImagesConditional', getImagesConditional);
  h.registerHelper('sectionCounter', sectionCounter);
}
