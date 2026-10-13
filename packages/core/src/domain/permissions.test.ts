import { describe, expect, it } from 'vitest';

import { isKnownPermission, PERMISSIONS, PERMISSION_KEYS, SYSTEM_ROLES } from './permissions.js';

describe('PERMISSIONS catalogue', () => {
  it('has no duplicate keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key is in resource:action form', () => {
    for (const p of PERMISSIONS) {
      expect(p.key).toBe(`${p.resource}:${p.action}`);
      expect(p.key).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('every permission has a non-empty description', () => {
    for (const p of PERMISSIONS) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('PERMISSION_KEYS mirrors PERMISSIONS exactly', () => {
    expect(PERMISSION_KEYS.size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) {
      expect(PERMISSION_KEYS.has(p.key)).toBe(true);
    }
  });

  it('includes the documented catalogue anchors (docs/08 §2)', () => {
    for (const key of [
      'dashboard:read',
      'orders:cancel',
      'orders:refund',
      'subscriptions:manage_plans',
      'catalog:publish',
      'customers:read_pii',
      'roles:manage',
      'admin_users:deactivate',
      'audit:read',
    ]) {
      expect(isKnownPermission(key)).toBe(true);
    }
  });
});

describe('isKnownPermission', () => {
  it('accepts a real permission key', () => {
    expect(isKnownPermission('orders:read')).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(isKnownPermission('not_a_real:permission')).toBe(false);
  });

  it('rejects a resource-only or malformed key', () => {
    expect(isKnownPermission('orders')).toBe(false);
    expect(isKnownPermission('orders:')).toBe(false);
    expect(isKnownPermission('')).toBe(false);
  });
});

describe('SYSTEM_ROLES (docs/08 §3, +Phase 06 DELIVERY_PARTNER)', () => {
  it('defines the seven MVP roles plus Phase 06 DELIVERY_PARTNER', () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(keys).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'OPERATIONS_MANAGER',
      'INVENTORY_MANAGER',
      'ORDER_MANAGER',
      'CUSTOMER_SUPPORT',
      'CONTENT_MANAGER',
      'DELIVERY_PARTNER',
    ]);
  });

  it('has no duplicate role keys', () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every permission every role grants is a real, known permission — no role references a typo', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.length).toBeGreaterThan(0);
      for (const key of role.permissions) {
        expect(isKnownPermission(key)).toBe(true);
      }
    }
  });

  it('no role grants the same permission twice (expand() de-duplicates resource:* correctly)', () => {
    for (const role of SYSTEM_ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('ADMIN is a strict superset of OPERATIONS_MANAGER (doc 08 §3 — Admin has "everything operational")', () => {
    const admin = new Set(SYSTEM_ROLES.find((r) => r.key === 'ADMIN')!.permissions);
    const ops = SYSTEM_ROLES.find((r) => r.key === 'OPERATIONS_MANAGER')!.permissions;
    for (const key of ops) {
      expect(admin.has(key)).toBe(true);
    }
  });

  it('only ADMIN and SUPER_ADMIN may manage admin_users (docs/08 §3 role table)', () => {
    for (const role of SYSTEM_ROLES) {
      const managesStaff = role.permissions.includes('admin_users:create');
      if (managesStaff) {
        expect(['SUPER_ADMIN', 'ADMIN']).toContain(role.key);
      }
    }
  });

  it('CUSTOMER_SUPPORT lacks orders:update_status (support must not mark an order delivered)', () => {
    const support = SYSTEM_ROLES.find((r) => r.key === 'CUSTOMER_SUPPORT')!;
    expect(support.permissions).not.toContain('orders:update_status');
    expect(support.permissions).toContain('subscriptions:cancel');
  });

  it('ORDER_MANAGER lacks orders:cancel and customers:read_pii (narrower than Operations Manager)', () => {
    const orderManager = SYSTEM_ROLES.find((r) => r.key === 'ORDER_MANAGER')!;
    expect(orderManager.permissions).not.toContain('orders:cancel');
    expect(orderManager.permissions).not.toContain('customers:read_pii');
  });

  it('CONTENT_MANAGER has no access to inventory, orders or customer data', () => {
    const content = SYSTEM_ROLES.find((r) => r.key === 'CONTENT_MANAGER')!;
    for (const key of content.permissions) {
      expect(key.startsWith('inventory:')).toBe(false);
      expect(key.startsWith('orders:')).toBe(false);
      expect(key.startsWith('customers:')).toBe(false);
    }
  });
});
