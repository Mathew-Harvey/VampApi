import { describe, it, expect } from 'vitest';
import {
  loginSchema, registerSchema, forgotPasswordSchema,
  resetPasswordSchema, changePasswordSchema,
} from '../../src/schemas/user.schema';
import { createVesselSchema, updateVesselSchema } from '../../src/schemas/vessel.schema';
import {
  createWorkOrderSchema, changeStatusSchema, assignWorkOrderSchema,
} from '../../src/schemas/work-order.schema';
import {
  createInspectionSchema, createFindingSchema,
} from '../../src/schemas/inspection.schema';

// ──────────────────────────────────────────────────────────
// User schemas
// ──────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts valid login data', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '12345678' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-email', password: '12345678' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '1234' });
    expect(result.success).toBe(false);
  });

  it('accepts optional organisationId', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '12345678', organisationId: 'org1' });
    expect(result.success).toBe(true);
    expect(result.data?.organisationId).toBe('org1');
  });
});

describe('registerSchema', () => {
  it('accepts valid registration data', () => {
    const result = registerSchema.safeParse({
      email: 'user@test.com', password: 'securepass1', firstName: 'John', lastName: 'Doe',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing firstName', () => {
    const result = registerSchema.safeParse({
      email: 'user@test.com', password: 'securepass1', firstName: '', lastName: 'Doe',
    });
    expect(result.success).toBe(false);
  });

  it('accepts nullable phone', () => {
    const result = registerSchema.safeParse({
      email: 'user@test.com', password: 'securepass1', firstName: 'A', lastName: 'B', phone: null,
    });
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBeNull();
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts valid token and password', () => {
    const result = resetPasswordSchema.safeParse({ token: 'abc123', password: 'newpass12' });
    expect(result.success).toBe(true);
  });

  it('rejects empty token', () => {
    expect(resetPasswordSchema.safeParse({ token: '', password: 'newpass12' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('accepts valid data', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'newpass12' });
    expect(result.success).toBe(true);
  });

  it('rejects short new password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: '1234' }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Vessel schemas
// ──────────────────────────────────────────────────────────

describe('createVesselSchema', () => {
  it('accepts minimal valid vessel', () => {
    const result = createVesselSchema.safeParse({ name: 'MV Test', vesselType: 'CARGO_SHIP' });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(createVesselSchema.safeParse({ vesselType: 'CARGO_SHIP' }).success).toBe(false);
  });

  it('rejects missing vesselType', () => {
    expect(createVesselSchema.safeParse({ name: 'MV Test' }).success).toBe(false);
  });

  it('accepts all optional fields', () => {
    const result = createVesselSchema.safeParse({
      name: 'MV Full',
      vesselType: 'TANKER',
      imoNumber: '1234567',
      mmsi: '987654321',
      callSign: 'VK9ABC',
      flagState: 'Australia',
      grossTonnage: 50000,
      lengthOverall: 200.5,
      beam: 32.2,
      maxDraft: 12.0,
      yearBuilt: 2020,
      climateZones: ['tropical', 'temperate'],
      metadata: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative grossTonnage', () => {
    const result = createVesselSchema.safeParse({
      name: 'MV Test', vesselType: 'CARGO_SHIP', grossTonnage: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects yearBuilt out of range', () => {
    const result = createVesselSchema.safeParse({
      name: 'MV Test', vesselType: 'CARGO_SHIP', yearBuilt: 1700,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateVesselSchema', () => {
  it('accepts partial updates', () => {
    const result = updateVesselSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = updateVesselSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// Work order schemas
// ──────────────────────────────────────────────────────────

describe('createWorkOrderSchema', () => {
  it('accepts minimal valid work order', () => {
    const result = createWorkOrderSchema.safeParse({
      vesselId: 'v1', title: 'Hull Inspection', type: 'INSPECTION',
    });
    expect(result.success).toBe(true);
    expect(result.data?.priority).toBe('NORMAL');
  });

  it('rejects missing vesselId', () => {
    expect(createWorkOrderSchema.safeParse({ title: 'Test', type: 'INSPECTION' }).success).toBe(false);
  });

  it('validates latitude range', () => {
    expect(createWorkOrderSchema.safeParse({
      vesselId: 'v1', title: 'Test', type: 'X', latitude: 91,
    }).success).toBe(false);
  });

  it('validates longitude range', () => {
    expect(createWorkOrderSchema.safeParse({
      vesselId: 'v1', title: 'Test', type: 'X', longitude: -181,
    }).success).toBe(false);
  });

  it('accepts fouling scale types', () => {
    const result = createWorkOrderSchema.safeParse({
      vesselId: 'v1', title: 'Test', type: 'INSPECTION', foulingScale: 'LOF',
    });
    expect(result.success).toBe(true);
  });
});

describe('changeStatusSchema', () => {
  it('accepts valid status', () => {
    expect(changeStatusSchema.safeParse({ status: 'IN_PROGRESS' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(changeStatusSchema.safeParse({ status: 'INVALID' }).success).toBe(false);
  });

  it('accepts optional reason', () => {
    const result = changeStatusSchema.safeParse({ status: 'CANCELLED', reason: 'Weather' });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBe('Weather');
  });
});

describe('assignWorkOrderSchema', () => {
  it('accepts valid assignment', () => {
    expect(assignWorkOrderSchema.safeParse({ userId: 'u1', role: 'LEAD' }).success).toBe(true);
  });

  it('rejects invalid role', () => {
    expect(assignWorkOrderSchema.safeParse({ userId: 'u1', role: 'SUPERADMIN' }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Inspection schemas
// ──────────────────────────────────────────────────────────

describe('createInspectionSchema', () => {
  it('accepts minimal valid inspection', () => {
    const result = createInspectionSchema.safeParse({
      workOrderId: 'wo1', vesselId: 'v1', type: 'UNDERWATER', inspectorName: 'J. Diver',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing inspectorName', () => {
    expect(createInspectionSchema.safeParse({
      workOrderId: 'wo1', vesselId: 'v1', type: 'UNDERWATER',
    }).success).toBe(false);
  });

  it('validates isoVisibility enum', () => {
    expect(createInspectionSchema.safeParse({
      workOrderId: 'wo1', vesselId: 'v1', type: 'X', inspectorName: 'A',
      isoVisibility: 'EXCELLENT',
    }).success).toBe(true);

    expect(createInspectionSchema.safeParse({
      workOrderId: 'wo1', vesselId: 'v1', type: 'X', inspectorName: 'A',
      isoVisibility: 'TERRIBLE',
    }).success).toBe(false);
  });
});

describe('createFindingSchema', () => {
  it('accepts minimal finding', () => {
    const result = createFindingSchema.safeParse({ area: 'Hull Port Side' });
    expect(result.success).toBe(true);
    expect(result.data?.actionRequired).toBe(false);
    expect(result.data?.priority).toBe('NORMAL');
  });

  it('validates foulingRating range', () => {
    expect(createFindingSchema.safeParse({ area: 'A', foulingRating: 6 }).success).toBe(false);
    expect(createFindingSchema.safeParse({ area: 'A', foulingRating: -1 }).success).toBe(false);
    expect(createFindingSchema.safeParse({ area: 'A', foulingRating: 3 }).success).toBe(true);
  });

  it('validates coverage range', () => {
    expect(createFindingSchema.safeParse({ area: 'A', coverage: 101 }).success).toBe(false);
    expect(createFindingSchema.safeParse({ area: 'A', coverage: -1 }).success).toBe(false);
    expect(createFindingSchema.safeParse({ area: 'A', coverage: 75 }).success).toBe(true);
  });
});
