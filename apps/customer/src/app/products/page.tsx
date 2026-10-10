import { Suspense } from 'react';

import { ProductGrid } from '@/components/product-grid';

export default function ProductsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">All products</h1>
      <div className="mt-5">
        <Suspense>
          <ProductGrid emptyTitle="No products yet" />
        </Suspense>
      </div>
    </main>
  );
}
