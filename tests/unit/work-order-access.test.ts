import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireWorkOrderView, requireWorkOrderWrite, requireWorkOrderAdmin } from '../../src/middleware/work-order-access';

// Mock the work-order service
vi.mock('../../src/services/work-order.service', () => ({
  workOrderService: {
    canViewWorkOrder: vi.fn(),
    canWriteAsCollaborator: vi.fn(),
    canAdminAsCollaborator: vi.fn(),
  },
}));

import { workOrderService } from '../../src/services/work-order.service';

const mockCanView = workOrderService.canViewWorkOrder as ReturnType<typeof vi.fn>;
const mockCanWrite = workOrderService.canWriteAsCollaborator as ReturnType<typeof vi.fn>;
const mockCanAdmin = workOrderService.canAdminAsCollaborator as ReturnType<typeof vi.fn>;

function createReq(overrides: Record<string, any> = {}) {
  return {
    params: { workOrderId: 'wo-1' },
    user: { userId: 'u-1', organisationId: 'org-1', permissions: [] as string[] },
    ...overrides,
  } as any;
}

function createRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────
// requireWorkOrderView
// ──────────────────────────────────────────────────────────

describe('requireWorkOrderView', () => {
  it('returns 404 when canViewWorkOrder returns false', async () => {
    mockCanView.mockResolvedValue(false);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderView()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status(404).json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'NOT_FOUND' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when canViewWorkOrder returns true', async () => {
    mockCanView.mockResolvedValue(true);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderView()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses custom param name', async () => {
    mockCanView.mockResolvedValue(true);
    const req = createReq({ params: { id: 'wo-custom' } });
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderView('id')(req, res, next);

    expect(mockCanView).toHaveBeenCalledWith('wo-custom', 'u-1', 'org-1', false);
    expect(next).toHaveBeenCalled();
  });

  it('includes organisation scope when user has WORK_ORDER_VIEW permission', async () => {
    mockCanView.mockResolvedValue(true);
    const req = createReq({ user: { userId: 'u-1', organisationId: 'org-1', permissions: ['WORK_ORDER_VIEW'] } });
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderView()(req, res, next);

    expect(mockCanView).toHaveBeenCalledWith('wo-1', 'u-1', 'org-1', true);
  });
});

// ──────────────────────────────────────────────────────────
// requireWorkOrderWrite
// ──────────────────────────────────────────────────────────

describe('requireWorkOrderWrite', () => {
  it('returns 404 when view check fails', async () => {
    mockCanView.mockResolvedValue(false);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderWrite()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
    // Should not even check write permission
    expect(mockCanWrite).not.toHaveBeenCalled();
  });

  it('returns 403 when view passes but write fails', async () => {
    mockCanView.mockResolvedValue(true);
    mockCanWrite.mockResolvedValue(false);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderWrite()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status(403).json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when both view and write pass via collaborator', async () => {
    mockCanView.mockResolvedValue(true);
    mockCanWrite.mockResolvedValue(true);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderWrite()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next when user has WORK_ORDER_EDIT org permission (skips collaborator check)', async () => {
    mockCanView.mockResolvedValue(true);
    const req = createReq({ user: { userId: 'u-1', organisationId: 'org-1', permissions: ['WORK_ORDER_EDIT'] } });
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderWrite()(req, res, next);

    expect(next).toHaveBeenCalled();
    // canWriteAsCollaborator is still called but result doesn't matter when org permission exists
  });
});

// ──────────────────────────────────────────────────────────
// requireWorkOrderAdmin
// ──────────────────────────────────────────────────────────

describe('requireWorkOrderAdmin', () => {
  it('returns 404 when view check fails', async () => {
    mockCanView.mockResolvedValue(false);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderAdmin()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
    expect(mockCanAdmin).not.toHaveBeenCalled();
  });

  it('returns 403 when view passes but admin fails', async () => {
    mockCanView.mockResolvedValue(true);
    mockCanAdmin.mockResolvedValue(false);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderAdmin()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status(403).json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when both view and admin pass via collaborator', async () => {
    mockCanView.mockResolvedValue(true);
    mockCanAdmin.mockResolvedValue(true);
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderAdmin()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next when user has WORK_ORDER_ASSIGN org permission', async () => {
    mockCanView.mockResolvedValue(true);
    const req = createReq({ user: { userId: 'u-1', organisationId: 'org-1', permissions: ['WORK_ORDER_ASSIGN'] } });
    const res = createRes();
    const next = vi.fn();

    await requireWorkOrderAdmin()(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
