import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Sidebar } from './sidebar.js';

vi.mock('next/navigation', () => ({
  usePathname: () => '/employees',
}));

describe('Sidebar', () => {
  it('hides a permission-gated item the caller lacks the permission for', () => {
    render(<Sidebar permissions={new Set()} />);
    expect(screen.queryByText('Employees')).not.toBeInTheDocument();
    // Orders has no permission gate — always visible to an authenticated admin.
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('shows a permission-gated item once the caller holds that permission', () => {
    render(<Sidebar permissions={new Set(['admin_users:read'])} />);
    expect(screen.getByText('Employees')).toBeInTheDocument();
  });

  it('marks the current route as the active nav item', () => {
    render(<Sidebar permissions={new Set(['admin_users:read'])} />);
    expect(screen.getByRole('link', { name: /Employees/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Orders/ })).not.toHaveAttribute('aria-current');
  });

  it('treats a null (not-yet-loaded) permission set as showing nothing gated, never everything', () => {
    render(<Sidebar permissions={null} />);
    expect(screen.queryByText('Employees')).not.toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });
});
