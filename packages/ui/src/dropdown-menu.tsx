'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from './cn.js';

export type DropdownItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export function DropdownMenu({
  trigger,
  items,
  align = 'end',
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            'bg-sand-0 border-sand-200 absolute z-20 mt-2 min-w-[12rem] rounded-md border py-1 shadow-md',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'text-body-sm block w-full px-3.5 py-2.5 text-left',
                'hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-50',
                item.destructive ? 'text-danger-600' : 'text-sand-800',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
