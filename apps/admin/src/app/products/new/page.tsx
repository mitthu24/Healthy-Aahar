'use client';

import type { AdminCategoryDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import { Button, Card, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<AdminCategoryDto[] | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void apiClient.listAdminCategories({ limit: 100, is_active: true }).then((res) => {
      setCategories(res.data);
      if (res.data[0]) setCategoryId(res.data[0].id);
    });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!categoryId) {
      setError('Create a category first.');
      return;
    }

    setIsSubmitting(true);
    try {
      const product = await apiClient.createProduct({
        name,
        slug,
        category_id: categoryId,
        short_description: shortDescription || undefined,
      });
      router.push(`/products/${product.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this product.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="font-display text-heading-lg text-sand-900">New product</h1>
      <p className="text-body-sm text-sand-600 mt-2">
        Created as a draft. Add a variant with a price and stock, then publish it.
      </p>

      <Card className="mt-6 p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="p-name">Name</FieldLabel>
            <Input
              id="p-name"
              required
              className="mt-1"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div>
            <FieldLabel htmlFor="p-slug">Slug</FieldLabel>
            <Input
              id="p-slug"
              required
              className="mt-1"
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugEdited(true);
              }}
            />
          </div>
          <div>
            <FieldLabel htmlFor="p-category">Category</FieldLabel>
            <select
              id="p-category"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="border-sand-200 bg-sand-0 text-body-md mt-1 h-11 w-full rounded-md border px-3"
            >
              {categories === null ? <option>Loading…</option> : null}
              {categories?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categories && categories.length === 0 ? (
              <p className="text-caption text-danger-600 mt-1">
                No categories yet — create one first.
              </p>
            ) : null}
          </div>
          <div>
            <FieldLabel htmlFor="p-short-desc">Short description (optional)</FieldLabel>
            <Input
              id="p-short-desc"
              className="mt-1"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
            />
          </div>

          <FieldError>{error}</FieldError>

          <Button
            type="submit"
            isLoading={isSubmitting}
            disabled={!categories || categories.length === 0}
          >
            Create product
          </Button>
        </form>
      </Card>
    </main>
  );
}
