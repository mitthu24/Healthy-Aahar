import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileNav } from './mobile-nav.js';

const adminMe = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/orders',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { adminMe: () => adminMe(), adminLogout: () => Promise.resolve({ signed_out: true }) },
}));

beforeEach(() => {
  adminMe.mockResolvedValue({ full_name: 'Test Admin', must_change_password: false });
});

describe('MobileNav', () => {
  it('opens the drawer on menu button click and closes it on Escape', async () => {
    render(<MobileNav permissions={new Set(['admin_users:read'])} />);

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('closes the drawer on its close button', async () => {
    render(<MobileNav permissions={new Set()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('only shows bottom-nav items the caller has permission for, among the configured set', () => {
    const { rerender } = render(<MobileNav permissions={new Set()} />);
    expect(screen.queryByText('Delivery Partners')).not.toBeInTheDocument();

    rerender(<MobileNav permissions={new Set(['delivery_partners:read'])} />);
    expect(screen.getByText('Delivery Partners')).toBeInTheDocument();
  });
});
