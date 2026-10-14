import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_GROUPS } from './nav.js';

describe('isNavItemActive', () => {
  it('matches the dashboard only on the exact root path', () => {
    expect(isNavItemActive('/', '/')).toBe(true);
    expect(isNavItemActive('/orders', '/')).toBe(false);
  });

  it('matches a section and any of its sub-routes', () => {
    expect(isNavItemActive('/employees', '/employees')).toBe(true);
    expect(isNavItemActive('/employees/abc-123', '/employees')).toBe(true);
    expect(isNavItemActive('/employees-archive', '/employees')).toBe(false);
  });
});

describe('NAV_GROUPS', () => {
  it('every item has a unique href', () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('every permission-gated item uses a resource:action-shaped key', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.permission) {
          expect(item.permission).toMatch(/^[a-z_]+:[a-z_]+$/);
        }
      }
    }
  });
});
