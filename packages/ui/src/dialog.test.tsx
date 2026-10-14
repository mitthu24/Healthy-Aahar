import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './dialog.js';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Delete item">
        Body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders with accessible dialog role and title when open', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Delete item" description="This cannot be undone.">
        Body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Delete item')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Delete item">
        Body
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Delete item">
        <button type="button">Inner content</button>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Inner content'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves initial focus inside the dialog', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Delete item" footer={<button>Confirm</button>}>
        Body
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });
});
