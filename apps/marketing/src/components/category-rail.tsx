import type { CategoryDto } from '@healthy-aahar/sdk';
import Image from 'next/image';
import Link from 'next/link';

import { apiClient } from '@/lib/api-client';

import { Container } from './container';
import { SectionHeading } from './section-heading';

async function getCategories(): Promise<CategoryDto[]> {
  try {
    const { data } = await apiClient.listCategories();
    return data;
  } catch {
    return [];
  }
}

export async function CategoryRail() {
  const categories = await getCategories();
  if (categories.length === 0) return null;

  return (
    <section className="bg-sand-0 py-16 sm:py-20">
      <Container>
        <SectionHeading eyebrow="Shop by category" title="Everything, grouped the way you shop" />

        <div className="mt-10 flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible lg:grid-cols-6">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/products?category=${category.id}`}
              className="group focus-visible:ring-green-600 w-32 shrink-0 text-center focus-visible:outline-none focus-visible:ring-2 sm:w-auto"
            >
              <div className="bg-sand-100 relative aspect-square w-full overflow-hidden rounded-2xl">
                {category.image_url ? (
                  <Image
                    src={category.image_url}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 128px, 160px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="text-sand-400 text-caption flex h-full items-center justify-center">
                    {category.name}
                  </div>
                )}
              </div>
              <p className="text-body-sm text-sand-800 group-hover:text-green-700 mt-2 font-medium">
                {category.name}
              </p>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}
