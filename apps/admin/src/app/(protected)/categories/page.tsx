'use client';

import type { AdminCategoryDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
} from '@healthy-aahar/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CategoryForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: AdminCategoryDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(Boolean(initial));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (initial) {
        await apiClient.updateCategory(initial.id, {
          name,
          description: description || null,
          image_url: imageUrl || null,
        });
      } else {
        await apiClient.createCategory({
          name,
          slug,
          description: description || undefined,
          image_url: imageUrl || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this category.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <FieldLabel htmlFor="cat-name">Name</FieldLabel>
        <Input
          id="cat-name"
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
        <FieldLabel htmlFor="cat-slug">Slug</FieldLabel>
        <Input
          id="cat-slug"
          required
          disabled={Boolean(initial)}
          className="mt-1"
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugEdited(true);
          }}
        />
        {initial ? (
          <p className="text-caption text-sand-500 mt-1">Slug cannot be changed after creation.</p>
        ) : null}
      </div>
      <div>
        <FieldLabel htmlFor="cat-description">Description (optional)</FieldLabel>
        <Input
          id="cat-description"
          className="mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="cat-image">Image URL (optional)</FieldLabel>
        <Input
          id="cat-image"
          className="mt-1"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {initial ? 'Save changes' : 'Create category'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<AdminCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminCategoryDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.listAdminCategories({ limit: 100 });
      setCategories(result.data);
    } catch {
      setError('Could not load categories.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function confirmDelete(id: string) {
    setDeleteError(null);
    try {
      await apiClient.deleteCategory(id);
      setConfirmingDeleteId(null);
      void load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this category.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-heading-lg text-sand-900">Categories</h1>
        {!showCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowCreate(true);
            }}
          >
            New category
          </Button>
        ) : null}
      </div>

      {showCreate ? (
        <Card className="mt-5 p-5">
          <h2 className="text-heading-sm text-sand-900">
            {editing ? 'Edit category' : 'New category'}
          </h2>
          <div className="mt-4">
            <CategoryForm
              initial={editing ?? undefined}
              onCancel={() => setShowCreate(false)}
              onSaved={() => {
                setShowCreate(false);
                void load();
              }}
            />
          </div>
        </Card>
      ) : null}

      {deleteError ? <p className="text-body-sm text-danger-600 mt-4">{deleteError}</p> : null}

      <div className="mt-6 space-y-3">
        {categories === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : categories.length === 0 && !showCreate ? (
          <EmptyState
            title="No categories yet"
            description="Create one to start adding products."
          />
        ) : (
          categories.map((category) => (
            <Card key={category.id} className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body-sm text-sand-900 font-semibold">{category.name}</p>
                  {!category.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                </div>
                <p className="text-caption text-sand-600 mt-0.5">
                  /{category.slug} · {category.product_count} product
                  {category.product_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await apiClient.updateCategory(category.id, { is_active: !category.is_active });
                    void load();
                  }}
                >
                  {category.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(category);
                    setShowCreate(true);
                  }}
                >
                  Edit
                </Button>
                {confirmingDeleteId === category.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void confirmDelete(category.id)}
                    >
                      Confirm delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingDeleteId(category.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
