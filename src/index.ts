import http from 'http';
import app from './app';
import { env } from './config/env';
import prisma from './config/database';
import { initSignaling } from './signaling';
import { authenticate } from './middleware/auth';
import { hasAnyPermission } from './middleware/permissions';
import { workOrderService } from './services/work-order.service';

const PORT = env.PORT;

async function main() {
  // Test database connection
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Create HTTP server and attach Socket.IO for WebRTC signaling
  const httpServer = http.createServer(app);
  const { io } = initSignaling(httpServer);

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

  httpServer.listen(PORT, () => {
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
