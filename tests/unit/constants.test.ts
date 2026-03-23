import { describe, it, expect } from 'vitest';
import { PERMISSIONS, ROLES, ROLE_DEFAULT_PERMISSIONS } from '../../src/constants/permissions';

describe('PERMISSIONS', () => {
  it('contains expected core permissions', () => {
    expect(PERMISSIONS).toContain('VESSEL_VIEW');
    expect(PERMISSIONS).toContain('VESSEL_CREATE');
    expect(PERMISSIONS).toContain('WORK_ORDER_VIEW');
    expect(PERMISSIONS).toContain('INSPECTION_VIEW');
    expect(PERMISSIONS).toContain('ADMIN_FULL_ACCESS');
  });

  it('has no duplicates', () => {
    const unique = new Set(PERMISSIONS);
    expect(unique.size).toBe(PERMISSIONS.length);
  });
});

describe('ROLES', () => {
  it('includes all expected roles', () => {
    expect(Object.keys(ROLES)).toEqual([
      'ECOSYSTEM_ADMIN',
      'ORGANISATION_ADMIN',
      'MANAGER',
      'OPERATOR',
      'VIEWER',
    ]);
  });
});

describe('ROLE_DEFAULT_PERMISSIONS', () => {
  it('has a permission set for every role', () => {
    for (const role of Object.keys(ROLES)) {
      expect(ROLE_DEFAULT_PERMISSIONS).toHaveProperty(role);
      expect(Array.isArray(ROLE_DEFAULT_PERMISSIONS[role as keyof typeof ROLE_DEFAULT_PERMISSIONS])).toBe(true);
    }
  });

  it('ECOSYSTEM_ADMIN has ADMIN_FULL_ACCESS', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ECOSYSTEM_ADMIN).toContain('ADMIN_FULL_ACCESS');
  });

  it('VIEWER has only view permissions', () => {
    const viewerPerms = ROLE_DEFAULT_PERMISSIONS.VIEWER;
    for (const perm of viewerPerms) {
      expect(perm).toMatch(/VIEW$/);
    }
  });

  it('ORGANISATION_ADMIN has more permissions than VIEWER', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ORGANISATION_ADMIN.length).toBeGreaterThan(
      ROLE_DEFAULT_PERMISSIONS.VIEWER.length,
    );
  });

  it('every permission in ROLE_DEFAULT_PERMISSIONS is valid', () => {
    const allPerms = new Set(PERMISSIONS);
    for (const [_, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const perm of perms) {
        expect(allPerms.has(perm)).toBe(true);
      }
    }
  });
});
