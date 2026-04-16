import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { notFound, errorHandler } from './middleware/error';

// Routes
import authRoutes from './routes/auth.routes';
import vesselRoutes from './routes/vessel.routes';
import workOrderRoutes from './routes/work-order.routes';
import inspectionRoutes from './routes/inspection.routes';
import mediaRoutes from './routes/media.routes';
import dashboardRoutes from './routes/dashboard.routes';
import auditRoutes from './routes/audit.routes';
import userRoutes from './routes/user.routes';
import organisationRoutes from './routes/organisation.routes';
import reportRoutes from './routes/report.routes';
import workflowRoutes from './routes/workflow.routes';
import notificationRoutes from './routes/notification.routes';
import workFormRoutes from './routes/work-form.routes';
import inviteRoutes from './routes/invite.routes';
import vesselShareRoutes from './routes/vessel-share.routes';
import storageRoutes from './routes/storage.routes';
import prisma from './config/database';
import { storageConfigService } from './services/storage-config.service';

const app = express();
app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

import { getAllowedOrigins, isOriginAllowed } from './config/cors';
app.use(cors({
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    console.warn(`CORS rejected origin: ${origin}. Allowed: ${getAllowedOrigins().join(', ')}`);
    cb(null, false);
  },
  credentials: true,
}));

const noopLimiter = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
const isTest = process.env.NODE_ENV === 'test';
const rateLimitMessage = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } };

const authLimiter = isTest
  ? noopLimiter
  : rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: rateLimitMessage });

const sensitiveLimiter = isTest
  ? noopLimiter
  : rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: rateLimitMessage });

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// Static files (uploads) — served from configurable local media path
app.use('/uploads', (req, res, next) => {
  express.static(storageConfigService.getLocalMediaPath())(req, res, next);
});

// Email previews (dev only)
const isDevEnvironment = process.env.NODE_ENV === 'development';
if (isDevEnvironment) {
  app.use('/email-previews', express.static(path.join(process.cwd(), 'email-previews')));
  app.get('/api/v1/email-previews', (_req, res) => {
    const dir = path.join(process.cwd(), 'email-previews');
    try {
      if (!fs.existsSync(dir)) { res.json({ success: true, data: [] }); return; }
      const files = fs.readdirSync(dir)
        .filter((f: string) => f.endsWith('.html'))
        .sort((a: string, b: string) => b.localeCompare(a))
        .slice(0, 20)
        .map((f: string) => ({ filename: f, url: `/email-previews/${f}` }));
      res.json({ success: true, data: files });
    } catch { res.json({ success: true, data: [] }); }
  });
}

// Health check
app.get('/api/v1/health', async (_req, res) => {
  const dbHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API Routes
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1', workFormRoutes); // Must be before /vessels so /vessels/:id/components is handled
app.use('/api/v1', sensitiveLimiter, inviteRoutes);
app.use('/api/v1/vessels', vesselRoutes);
app.use('/api/v1/vessels', vesselShareRoutes);
app.use('/api/v1/work-orders', workOrderRoutes);
app.use('/api/v1/inspections', inspectionRoutes);
app.use('/api/v1/media', sensitiveLimiter, mediaRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/users', sensitiveLimiter, userRoutes);
app.use('/api/v1/organisations', organisationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/storage', sensitiveLimiter, storageRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
