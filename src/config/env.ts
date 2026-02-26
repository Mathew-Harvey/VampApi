import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from monorepo root (when running via npm run dev from root) or cwd
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') }); // from apps/api

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  S3_BUCKET: z.string().default('marinestream-media'),
  S3_REGION: z.string().default('ap-southeast-2'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('onboarding@resend.dev'),
  RESEND_API_KEY: z.string().default(''),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:3001'),
  // Optional: Rise-X third-party API sync (script only)
  RISE_X_API_URL: z.string().default(''),
  RISE_X_API_KEY: z.string().optional().default(''),
  // Optional: org id for synced fleet vessels (visible to all logged-in users)
  FLEET_ORG_ID: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return result.data;
}

export const env = validateEnv();
