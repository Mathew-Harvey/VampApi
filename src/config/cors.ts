/**
 * Shared CORS origin resolver used by both the Express app and Socket.IO.
 *
 * Supports comma-separated APP_URL values for multiple frontend origins,
 * e.g. APP_URL=https://vamp-web.onrender.com,https://staging.example.com
 */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getAllowedOrigins(): string[] {
  return (process.env.APP_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => stripTrailingSlashes(o.trim()))
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins?: string[]): boolean {
  if (!origin) return true; // same-origin / Postman
  const allowed = allowedOrigins ?? getAllowedOrigins();
  // Normalise the incoming origin the same way we normalise configured ones so
  // `https://example.com/` and `https://example.com` are treated as equal.
  const normalised = stripTrailingSlashes(origin);
  if (allowed.includes(normalised)) return true;
  // In development, allow any localhost port
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(normalised)) return true;
  return false;
}
