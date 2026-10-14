'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';

import { cn } from './cn.js';

type TabsContextValue = { value: string; onChange: (value: string) => void; name: string };
const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.List/Tab/Panel must be rendered inside <Tabs>');
  return ctx;
}

export function Tabs({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const name = useId();
  return (
    <TabsContext.Provider value={{ value, onChange, name }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn('border-sand-200 flex gap-1 overflow-x-auto border-b', className)}
    >
      {children}
    </div>
  );
}

export function Tab({
  value: tabValue,
  children,
  disabled,
}: {
  value: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const { value, onChange, name } = useTabsContext();
  const selected = value === tabValue;
  return (
    <button
      type="button"
      role="tab"
      id={`${name}-tab-${tabValue}`}
      aria-selected={selected}
      aria-controls={`${name}-panel-${tabValue}`}
      disabled={disabled}
      onClick={() => onChange(tabValue)}
      className={cn(
        'text-body-sm shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-green-600 text-green-700'
          : 'text-sand-600 hover:text-sand-800 border-transparent',
      )}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value: tabValue, children }: { value: string; children: ReactNode }) {
  const { value, name } = useTabsContext();
  if (value !== tabValue) return null;
  return (
    <div
      role="tabpanel"
      id={`${name}-panel-${tabValue}`}
      aria-labelledby={`${name}-tab-${tabValue}`}
      tabIndex={0}
      className="pt-4"
    >
      {children}
    </div>
  );
}
