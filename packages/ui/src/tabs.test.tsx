import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Tab, TabList, TabPanel, Tabs } from './tabs.js';

function Example() {
  const [value, setValue] = useState('orders');
  return (
    <Tabs value={value} onChange={setValue}>
      <TabList>
        <Tab value="orders">Orders</Tab>
        <Tab value="payments">Payments</Tab>
      </TabList>
      <TabPanel value="orders">Orders panel</TabPanel>
      <TabPanel value="payments">Payments panel</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('marks only the active tab as selected and shows only its panel', async () => {
    render(<Example />);
    expect(screen.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Orders panel')).toBeInTheDocument();
    expect(screen.queryByText('Payments panel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Payments panel')).toBeInTheDocument();
    expect(screen.queryByText('Orders panel')).not.toBeInTheDocument();
  });
});
