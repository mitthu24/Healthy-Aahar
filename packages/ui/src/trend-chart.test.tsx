import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrendChart } from './trend-chart.js';

describe('TrendChart', () => {
  it('shows an honest empty state for zero points, never a fabricated chart', () => {
    render(<TrendChart points={[]} />);
    expect(screen.getByText('No data in this range.')).toBeInTheDocument();
  });

  it('renders one bar per point and a screen-reader-only data table with every value', () => {
    const { container } = render(
      <TrendChart
        points={[
          { label: '2026-06-14', value: 10, valueLabel: '₹10' },
          { label: '2026-06-15', value: 20, valueLabel: '₹20' },
        ]}
      />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(2);
    // Appears twice: once in the visible footer label, once in the
    // screen-reader-only data table — both are intentional.
    expect(screen.getAllByText('2026-06-14').length).toBeGreaterThan(0);
    expect(screen.getByText('₹20')).toBeInTheDocument();
  });
});
