import http from 'http';
import app from './app';
import { env } from './config/env';
import prisma from './config/database';
import { initSignaling } from './signaling';
import { authenticate } from './middleware/auth';
import { hasAnyPermission } from './middleware/permissions';
import { workOrderService } from './services/work-order.service';

const PORT = env.PORT;
let server: http.Server | null = null;
let signalingIo: { close: () => void } | null = null;
let isShuttingDown = false;

async function connectWithRetry(maxRetries = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      console.log('Database connected successfully');
      return;
    } catch (error) {
      console.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, error instanceof Error ? error.message : error);
      if (attempt === maxRetries) {
        throw new Error('Could not connect to database after maximum retries');
      }
      console.log(`Retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
}

async function main() {
  await connectWithRetry();

  // Create HTTP server and attach Socket.IO for WebRTC signaling
  const httpServer = http.createServer(app);
  const { io } = initSignaling(httpServer);
  server = httpServer;
  signalingIo = io;

  // Add room status REST endpoint
  app.get('/api/v1/video/room-status/:workOrderId', authenticate, async (req, res) => {
    const workOrderId = req.params.workOrderId as string;
    const hasAccess = await workOrderService.canViewWorkOrder(
      workOrderId,
      req.user!.userId,
      req.user!.organisationId,
      hasAnyPermission(req.user, 'WORK_ORDER_VIEW'),
    );
    if (!hasAccess) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } });
      return;
    }

    const roomId = `wo-${workOrderId}`;
    const nsp = io.of('/');
    const room = nsp.adapter.rooms.get(roomId);
    const count = room?.size || 0;
    res.json({ success: true, data: { workOrderId, count, isActive: count > 0 } });
  });

  server.listen(PORT, () => {
    console.log(`MarineStream API running on port ${PORT}`);
    console.log(`WebSocket signaling server active`);
    console.log(`Environment: ${env.NODE_ENV}`);
    console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`${signal} received, shutting down...`);
  try {
    if (signalingIo) {
      signalingIo.close();
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
