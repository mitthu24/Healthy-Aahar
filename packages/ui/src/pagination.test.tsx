import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pagination } from './pagination.js';

describe('Pagination', () => {
  it('renders nothing when there is no more data', () => {
    const { container } = render(
      <Pagination
        pagination={{ limit: 20, next_cursor: null, has_more: false }}
        onLoadMore={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when pagination is null (still loading)', () => {
    const { container } = render(<Pagination pagination={null} onLoadMore={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onLoadMore when there is more data', async () => {
    const onLoadMore = vi.fn();
    render(
      <Pagination
        pagination={{ limit: 20, next_cursor: 'abc', has_more: true }}
        onLoadMore={onLoadMore}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
