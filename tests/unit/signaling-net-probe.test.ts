import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

vi.mock('../../src/config/database', () => ({
  default: {
    $connect: vi.fn(),
    workOrder: {
      findFirst: vi.fn().mockResolvedValue({ id: 'wo-1' }),
    },
  },
}));

vi.mock('../../src/services/work-form.service', () => ({
  workFormService: {},
}));

function makeToken(userId: string, email: string) {
  return jwt.sign(
    { userId, email, organisationId: 'org-1', role: 'ORGANISATION_ADMIN', permissions: [] },
    env.JWT_SECRET,
    { expiresIn: '5m' },
  );
}

describe('Signaling net:ping / net:pong relay', () => {
  let httpServer: http.Server;
  let port: number;
  let clientA: ClientSocket;
  let clientB: ClientSocket;
  let clientC: ClientSocket;

  beforeAll(async () => {
    const { initSignaling } = await import('../../src/signaling');
    httpServer = http.createServer();
    initSignaling(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as any).port;

    const tokenA = makeToken('user-a', 'a@test.com');
    const tokenB = makeToken('user-b', 'b@test.com');
    const tokenC = makeToken('user-c', 'c@test.com');

    clientA = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      auth: { token: tokenA },
      transports: ['websocket'],
    });

    clientB = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      auth: { token: tokenB },
      transports: ['websocket'],
    });

    clientC = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      auth: { token: tokenC },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => clientA.on('connect', r)),
      new Promise<void>((r) => clientB.on('connect', r)),
      new Promise<void>((r) => clientC.on('connect', r)),
    ]);

    clientA.emit('room:join', { workOrderId: 'wo-1' });
    clientB.emit('room:join', { workOrderId: 'wo-1' });

    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(async () => {
    clientA?.disconnect();
    clientB?.disconnect();
    clientC?.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('relays net:ping from A to B with server timestamp', async () => {
    const received = new Promise<any>((resolve) => {
      clientB.once('net:ping', (data: any) => resolve(data));
    });

    clientA.emit('net:ping', {
      targetSocketId: clientB.id,
      probeId: 'probe-1',
      clientSentAt: 1000,
    });

    const data = await received;
    expect(data.fromSocketId).toBe(clientA.id);
    expect(data.probeId).toBe('probe-1');
    expect(data.clientSentAt).toBe(1000);
    expect(typeof data.serverReceivedAt).toBe('number');
  });

  it('relays net:pong from B to A with server timestamp', async () => {
    const received = new Promise<any>((resolve) => {
      clientA.once('net:pong', (data: any) => resolve(data));
    });

    clientB.emit('net:pong', {
      targetSocketId: clientA.id,
      probeId: 'probe-2',
      clientSentAt: 2000,
    });

    const data = await received;
    expect(data.fromSocketId).toBe(clientB.id);
    expect(data.probeId).toBe('probe-2');
    expect(data.clientSentAt).toBe(2000);
    expect(typeof data.serverReturnedAt).toBe('number');
  });

  it('does not relay net:ping to sockets outside the room', async () => {
    let pingReceived = false;
    clientC.once('net:ping', () => { pingReceived = true; });

    clientA.emit('net:ping', {
      targetSocketId: clientC.id,
      probeId: 'probe-3',
      clientSentAt: 3000,
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(pingReceived).toBe(false);
  });
});
