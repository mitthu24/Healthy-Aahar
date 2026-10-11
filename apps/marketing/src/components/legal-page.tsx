import type { ReactNode } from 'react';

import { Container } from './container';

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <Container className="max-w-2xl py-14 sm:py-20">
      <h1 className="font-display text-display-sm text-sand-900">{title}</h1>
      <p className="text-body-sm text-sand-400 mt-2">Last updated {updated}</p>
      <div
        className={[
          'mt-8',
          '[&_h2]:text-heading-sm [&_h2]:text-sand-900 [&_h2]:mt-9 [&_h2]:mb-2 [&_h2:first-child]:mt-0',
          '[&_p]:text-body-md [&_p]:text-sand-600 [&_p]:mt-3',
          '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:text-body-md [&_li]:text-sand-600 [&_li]:mt-1',
        ].join(' ')}
      >
        {children}
      </div>
    </Container>
  );
}

export function LegalNotice({ children }: { children: ReactNode }) {
  return (
    <div className="bg-warning-50 border-warning-100 text-body-sm text-sand-800 mt-10 rounded-lg border p-4">
      {children}
    </div>
  );
}
