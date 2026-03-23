import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from './config/env';
import prisma from './config/database';
import { workFormService } from './services/work-form.service';
import { isOriginAllowed } from './config/cors';
import { TokenPayload } from './config/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthenticatedSocket extends Socket {
  user: TokenPayload;
}

interface RoomParticipant {
  socketId: string;
  userId: string;
  userName: string;
  joinedAt: Date;
}

interface FieldLock {
  entryId: string;
  field: string;
  userId: string;
  userName: string;
  socketId: string;
  lockedAt: Date;
}

/** WebRTC session description forwarded between peers */
interface RTCDescription {
  type: string;
  sdp?: string;
}

/** WebRTC ICE candidate forwarded between peers */
interface RTCCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

/** Payload for signal:offer from the client */
interface SignalOfferData {
  targetSocketId: string;
  offer: RTCDescription;
}

/** Payload for signal:answer from the client */
interface SignalAnswerData {
  targetSocketId: string;
  answer: RTCDescription;
}

/** Payload for signal:ice-candidate from the client */
interface SignalIceCandidateData {
  targetSocketId: string;
  candidate: RTCCandidate;
}

/** Payload for form:update from the client */
interface FormUpdateData {
  workOrderId: string;
  entryId: string;
  field: string;
  value: unknown;
}

/** Payload for form:lock / form:unlock */
interface FormFieldData {
  workOrderId: string;
  entryId: string;
  field: string;
}

/** Payload for form:screenshot-media */
interface FormScreenshotMediaData {
  workOrderId: string;
  entryId: string;
  mediaId: string;
}

/** Payload for form:screenshot-remove */
interface FormScreenshotRemoveData {
  workOrderId: string;
  entryId: string;
  index: number;
}

/** Payload for events that only carry a workOrderId */
interface WorkOrderData {
  workOrderId: string;
}

/** Payload for form:complete */
interface FormCompleteData {
  workOrderId: string;
  entryId: string;
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(message: string): void {
  console.log(`[WS] ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const rooms = new Map<string, Map<string, RoomParticipant>>();
/** Field locks: workOrderId -> "entryId:field" -> FieldLock */
const formLocks = new Map<string, Map<string, FieldLock>>();
/** Track which socket is in which form rooms for cleanup on disconnect */
const socketFormRooms = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// Access check
// ---------------------------------------------------------------------------

async function hasWorkOrderAccess(
  workOrderId: string,
  organisationId: string,
  userId: string,
): Promise<boolean> {
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      isDeleted: false,
      OR: [
        { organisationId },
        { assignments: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(workOrder);
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

function leaveVideoRoom(
  socket: Socket,
  roomId: string,
  ioServer: SocketIOServer,
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(socket.id);
  socket.leave(roomId);

  if (room.size === 0) {
    rooms.delete(roomId);
  }

  socket.to(roomId).emit('peer:left', { socketId: socket.id });

  const workOrderId = roomId.replace('wo-', '');
  // Broadcast to both video and form rooms
  ioServer.to(roomId).emit('room:count', { workOrderId, count: room.size });
  ioServer.to(`form-${workOrderId}`).emit('room:count', { workOrderId, count: room.size });
}

function leaveFormRoom(
  socket: Socket,
  workOrderId: string,
  ioServer: SocketIOServer,
): void {
  const formRoomId = `form-${workOrderId}`;
  socket.leave(formRoomId);

  // Release all field locks held by this socket
  const locks = formLocks.get(workOrderId);
  if (locks) {
    const toUnlock: string[] = [];
    for (const [lockKey, lock] of locks) {
      if (lock.socketId === socket.id) {
        toUnlock.push(lockKey);
      }
    }
    for (const lockKey of toUnlock) {
      const lock = locks.get(lockKey)!;
      locks.delete(lockKey);
      ioServer.to(formRoomId).emit('form:unlocked', {
        workOrderId,
        entryId: lock.entryId,
        field: lock.field,
      });
    }
    if (locks.size === 0) {
      formLocks.delete(workOrderId);
    }
  }

  const tracked = socketFormRooms.get(socket.id);
  if (tracked) {
    tracked.delete(workOrderId);
  }
}

// ---------------------------------------------------------------------------
// Socket.IO initialisation
// ---------------------------------------------------------------------------

export function initSignaling(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
      credentials: true,
    },
    path: '/socket.io',
    maxHttpBufferSize: 5e6, // 5MB for screenshot data
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      (socket as AuthenticatedSocket).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (_socket: Socket) => {
    const socket = _socket as AuthenticatedSocket;
    const { user } = socket;
    log(`${user.email} connected (${socket.id})`);

    // ================================================================
    // VIDEO ROOM EVENTS
    // ================================================================

    socket.on('room:join', async ({ workOrderId }: WorkOrderData) => {
      const allowed = await hasWorkOrderAccess(workOrderId, user.organisationId, user.userId);
      if (!allowed) {
        socket.emit('room:error', { code: 'FORBIDDEN', message: 'Access denied' });
        return;
      }

      const roomId = `wo-${workOrderId}`;
      socket.join(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      const room = rooms.get(roomId)!;
      room.set(socket.id, {
        socketId: socket.id,
        userId: user.userId,
        userName: user.email,
        joinedAt: new Date(),
      });

      socket.to(roomId).emit('peer:joined', {
        socketId: socket.id,
        userId: user.userId,
        userName: user.email,
      });

      const existingPeers = Array.from(room.values())
        .filter((p) => p.socketId !== socket.id)
        .map((p) => ({ socketId: p.socketId, userId: p.userId, userName: p.userName }));
      socket.emit('room:state', { roomId, participants: existingPeers, count: room.size });

      // Broadcast count to BOTH video room and form room so all collaborators see it
      io.to(roomId).emit('room:count', { workOrderId, count: room.size });
      io.to(`form-${workOrderId}`).emit('room:count', { workOrderId, count: room.size });
    });

    socket.on('room:leave', ({ workOrderId }: WorkOrderData) => {
      leaveVideoRoom(socket, `wo-${workOrderId}`, io);
    });

    socket.on('signal:offer', ({ targetSocketId, offer }: SignalOfferData) => {
      io.to(targetSocketId).emit('signal:offer', {
        fromSocketId: socket.id,
        userId: user.userId,
        userName: user.email,
        offer,
      });
    });

    socket.on('signal:answer', ({ targetSocketId, answer }: SignalAnswerData) => {
      io.to(targetSocketId).emit('signal:answer', { fromSocketId: socket.id, answer });
    });

    socket.on('signal:ice-candidate', ({ targetSocketId, candidate }: SignalIceCandidateData) => {
      io.to(targetSocketId).emit('signal:ice-candidate', { fromSocketId: socket.id, candidate });
    });

    socket.on('room:status', async ({ workOrderId }: WorkOrderData) => {
      const roomId = `wo-${workOrderId}`;
      const room = rooms.get(roomId);
      const count = room?.size || 0;
      const participants = room
        ? Array.from(room.values()).map((p) => ({ userId: p.userId, userName: p.userName }))
        : [];
      socket.emit('room:status', { workOrderId, count, participants, isActive: count > 0 });
    });

    // ================================================================
    // FORM COLLABORATION EVENTS
    // ================================================================

    socket.on('form:join', async ({ workOrderId }: WorkOrderData) => {
      const allowed = await hasWorkOrderAccess(workOrderId, user.organisationId, user.userId);
      if (!allowed) {
        socket.emit('form:error', { code: 'FORBIDDEN', message: 'Access denied' });
        return;
      }

      const formRoomId = `form-${workOrderId}`;
      socket.join(formRoomId);

      // Track for disconnect cleanup
      if (!socketFormRooms.has(socket.id)) {
        socketFormRooms.set(socket.id, new Set());
      }
      socketFormRooms.get(socket.id)!.add(workOrderId);

      // Send current field lock state
      const locks = formLocks.get(workOrderId);
      if (locks && locks.size > 0) {
        const lockState = Array.from(locks.values()).map((l) => ({
          entryId: l.entryId,
          field: l.field,
          userId: l.userId,
          userName: l.userName,
        }));
        socket.emit('form:lock-state', { workOrderId, locks: lockState });
      }
    });

    socket.on('form:leave', ({ workOrderId }: WorkOrderData) => {
      leaveFormRoom(socket, workOrderId, io);
    });

    socket.on('form:lock', ({ workOrderId, entryId, field }: FormFieldData) => {
      if (!formLocks.has(workOrderId)) {
        formLocks.set(workOrderId, new Map());
      }
      const locks = formLocks.get(workOrderId)!;
      const lockKey = `${entryId}:${field}`;

      const existing = locks.get(lockKey);
      if (existing && existing.socketId !== socket.id) {
        socket.emit('form:lock-denied', {
          entryId,
          field,
          lockedBy: { userId: existing.userId, userName: existing.userName },
        });
        return;
      }

      locks.set(lockKey, {
        entryId,
        field,
        userId: user.userId,
        userName: user.email,
        socketId: socket.id,
        lockedAt: new Date(),
      });

      const formRoomId = `form-${workOrderId}`;
      io.to(formRoomId).emit('form:locked', {
        workOrderId,
        entryId,
        field,
        userId: user.userId,
        userName: user.email,
      });
    });

    socket.on('form:unlock', ({ workOrderId, entryId, field }: FormFieldData) => {
      const locks = formLocks.get(workOrderId);
      if (!locks) return;

      const lockKey = `${entryId}:${field}`;
      const lock = locks.get(lockKey);
      if (lock && lock.socketId === socket.id) {
        locks.delete(lockKey);
        const formRoomId = `form-${workOrderId}`;
        io.to(formRoomId).emit('form:unlocked', { workOrderId, entryId, field });
      }
    });

    socket.on('form:update', async ({ workOrderId, entryId, field, value }: FormUpdateData) => {
      try {
        await workFormService.updateField(entryId, field, value, user.userId);
        const formRoomId = `form-${workOrderId}`;
        // Broadcast to all OTHER users in the room
        socket.to(formRoomId).emit('form:updated', {
          workOrderId,
          entryId,
          field,
          value,
          userId: user.userId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        socket.emit('form:error', { code: 'UPDATE_FAILED', message });
      }
    });

    socket.on('form:screenshot-media', async ({ workOrderId, entryId, mediaId }: FormScreenshotMediaData) => {
      try {
        if (!mediaId || typeof mediaId !== 'string') {
          socket.emit('form:error', { code: 'SCREENSHOT_FAILED', message: 'mediaId is required' });
          return;
        }

        const updated = await workFormService.addAttachment(entryId, mediaId);
        const formRoomId = `form-${workOrderId}`;
        io.to(formRoomId).emit('form:screenshot-added', {
          workOrderId,
          entryId,
          mediaId: updated.mediaId,
          mediaUrl: updated.mediaUrl,
          attachments: updated.attachments,
          userId: user.userId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        socket.emit('form:error', { code: 'SCREENSHOT_FAILED', message });
      }
    });

    socket.on('form:screenshot-remove', async ({ workOrderId, entryId, index }: FormScreenshotRemoveData) => {
      try {
        const result = await workFormService.removeScreenshot(entryId, index);
        const formRoomId = `form-${workOrderId}`;
        io.to(formRoomId).emit('form:screenshot-removed', {
          workOrderId,
          entryId,
          attachments: result.attachments,
          userId: user.userId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        socket.emit('form:error', { code: 'SCREENSHOT_FAILED', message });
      }
    });

    socket.on('form:complete', async ({ workOrderId, entryId }: FormCompleteData) => {
      try {
        await workFormService.updateField(entryId, 'status', 'COMPLETED', user.userId);

        // Unlock all fields for this entry
        const locks = formLocks.get(workOrderId);
        if (locks) {
          const toDelete: string[] = [];
          for (const [key, lock] of locks) {
            if (lock.entryId === entryId) {
              toDelete.push(key);
            }
          }
          for (const key of toDelete) {
            locks.delete(key);
          }
        }

        const formRoomId = `form-${workOrderId}`;
        io.to(formRoomId).emit('form:completed', { workOrderId, entryId, userId: user.userId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        socket.emit('form:error', { code: 'COMPLETE_FAILED', message });
      }
    });

    // ================================================================
    // DISCONNECT
    // ================================================================

    socket.on('disconnect', () => {
      // Leave all video rooms
      for (const [roomId] of rooms) {
        leaveVideoRoom(socket, roomId, io);
      }

      // Leave all form rooms and release locks
      const woIds = socketFormRooms.get(socket.id);
      if (woIds) {
        for (const workOrderId of woIds) {
          leaveFormRoom(socket, workOrderId, io);
        }
        socketFormRooms.delete(socket.id);
      }

      log(`${user.email} disconnected`);
    });
  });

  return { io, rooms, formLocks };
}
