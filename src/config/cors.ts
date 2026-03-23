/**
 * Shared CORS origin resolver used by both the Express app and Socket.IO.
 *
 * Supports comma-separated APP_URL values for multiple frontend origins,
 * e.g. APP_URL=https://vamp-web.onrender.com,https://staging.example.com
 */
export function getAllowedOrigins(): string[] {
  return (process.env.APP_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins?: string[]): boolean {
  if (!origin) return true; // same-origin / Postman
  const allowed = allowedOrigins ?? getAllowedOrigins();
  if (allowed.includes(origin)) return true;
  // In development, allow any localhost port
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}
