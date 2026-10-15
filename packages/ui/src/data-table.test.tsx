import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from './data-table.js';

type Row = { id: string; name: string };

const columns: DataTableColumn<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];

describe('DataTable', () => {
  it('shows loading skeletons when data is null', () => {
    const { container } = render(<DataTable columns={columns} data={null} rowKey={(r) => r.id} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry action', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={null}
        rowKey={(r) => r.id}
        error="Could not load"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    screen.getByText('Try again').click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows an empty state for an empty array', () => {
    render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} emptyTitle="No rows" />);
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('renders rows in both the desktop table and the mobile card list', () => {
    render(<DataTable columns={columns} data={[{ id: '1', name: 'Jane' }]} rowKey={(r) => r.id} />);
    // Two renders of "Jane" — one in the <table> (desktop), one in the <ul> (mobile) — both exist in the DOM, CSS decides which is visible at a given width.
    expect(screen.getAllByText('Jane')).toHaveLength(2);
  });
});
