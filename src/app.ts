import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { notFound, errorHandler } from './middleware/error';
import { auditContext } from './middleware/audit';

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
import prisma from './config/database';

const app = express();

// Health check endpoint
app.get('/api/v1/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiting for auth endpoints (disabled in test to avoid 429 during integration tests)
const authLimiter = process.env.NODE_ENV === 'test'
  ? (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// Audit context
app.use(auditContext);

// Static files (uploads)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Email previews (dev only)
app.use('/email-previews', express.static(path.join(process.cwd(), 'email-previews')));
app.get('/api/v1/email-previews', (_req, res) => {
  const dir = path.join(process.cwd(), 'email-previews');
  try {
    const fs = require('fs');
    if (!fs.existsSync(dir)) { res.json({ success: true, data: [] }); return; }
    const files = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.html'))
      .sort((a: string, b: string) => b.localeCompare(a))
      .slice(0, 20)
      .map((f: string) => ({ filename: f, url: `/email-previews/${f}` }));
    res.json({ success: true, data: files });
  } catch { res.json({ success: true, data: [] }); }
});

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
app.use('/api/v1', inviteRoutes);
app.use('/api/v1/vessels', vesselRoutes);
app.use('/api/v1/work-orders', workOrderRoutes);
app.use('/api/v1/inspections', inspectionRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/organisations', organisationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
