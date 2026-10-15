import { Fragment, type ReactNode } from 'react';

import { cn } from './cn.js';

export type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="text-caption text-sand-500 flex items-center gap-1.5">
      {items.map((item, i) => (
        <Fragment key={`${item.label}-${i}`}>
          {i > 0 ? <span aria-hidden="true">/</span> : null}
          {item.href ? (
            <a href={item.href} className="hover:text-sand-700 hover:underline">
              {item.label}
            </a>
          ) : (
            <span className={i === items.length - 1 ? 'text-sand-700 font-medium' : undefined}>
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  action,
  className,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg text-sand-900">{title}</h1>
          {description ? <p className="text-body-sm text-sand-600 mt-1">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
