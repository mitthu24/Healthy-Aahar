'use client';

import type { AdminCategoryDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  ResponsiveContainer,
  Select,
  type DataTableColumn,
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
  /** Only top-level categories (no parent of their own) are valid parents
   *  — BR-C1, exactly two levels. Excludes `initial` itself when editing. */
  parentCandidates,
  onSaved,
  onCancel,
}: {
  initial?: AdminCategoryDto;
  parentCandidates: AdminCategoryDto[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(Boolean(initial));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [parentId, setParentId] = useState(initial?.parent_id ?? '');
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
          parent_id: parentId || null,
        });
      } else {
        await apiClient.createCategory({
          name,
          slug,
          description: description || undefined,
          image_url: imageUrl || undefined,
          parent_id: parentId || undefined,
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
        <FieldLabel htmlFor="cat-parent">Parent category (optional)</FieldLabel>
        <Select
          id="cat-parent"
          className="mt-1"
          value={parentId}
          placeholder="None — top-level category"
          options={parentCandidates.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setParentId(e.target.value)}
        />
        <p className="text-caption text-sand-500 mt-1">
          Makes this a subcategory. Categories are at most two levels deep, so a subcategory
          cannot itself be chosen as a parent.
        </p>
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
  const [confirmingDelete, setConfirmingDelete] = useState<AdminCategoryDto | null>(null);

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

  async function confirmDelete() {
    if (!confirmingDelete) return;
    setDeleteError(null);
    try {
      await apiClient.deleteCategory(confirmingDelete.id);
      setConfirmingDelete(null);
      void load();
    } catch (err) {
      setConfirmingDelete(null);
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this category.');
    }
  }

  // Rows ordered so each subcategory follows its parent, indented — a
  // simple, predictable two-level tree display without a separate
  // collapsible-tree component.
  const orderedRows: Array<{ category: AdminCategoryDto; indented: boolean }> = [];
  if (categories) {
    const byParent = new Map<string | null, AdminCategoryDto[]>();
    for (const category of categories) {
      const key = category.parent_id;
      byParent.set(key, [...(byParent.get(key) ?? []), category]);
    }
    for (const top of byParent.get(null) ?? []) {
      orderedRows.push({ category: top, indented: false });
      for (const child of byParent.get(top.id) ?? []) {
        orderedRows.push({ category: child, indented: true });
      }
    }
  }

  const columns: DataTableColumn<{ category: AdminCategoryDto; indented: boolean }>[] = [
    {
      key: 'name',
      header: 'Name',
      render: ({ category, indented }) => (
        <div className={indented ? 'pl-5' : undefined}>
          <div className="flex items-center gap-2">
            {indented ? <span className="text-sand-400">↳</span> : null}
            <p className="text-sand-900 font-semibold">{category.name}</p>
            {!category.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
          </div>
          <p className="text-caption text-sand-600 mt-0.5">
            /{category.slug} · {category.product_count} product
            {category.product_count === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: ({ category }) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async (e) => {
              e.stopPropagation();
              await apiClient.updateCategory(category.id, { is_active: !category.is_active });
              void load();
            }}
          >
            {category.is_active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(category);
              setShowCreate(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmingDelete(category);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // Valid parent candidates: top-level categories only, excluding the
  // category currently being edited (it can't be its own parent).
  const parentCandidates = (categories ?? []).filter(
    (c) => c.parent_id === null && c.id !== editing?.id,
  );

  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Categories"
          description="Organize the catalogue into categories and subcategories."
          action={
            !showCreate ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowCreate(true);
                }}
              >
                New category
              </Button>
            ) : undefined
          }
        />

        {showCreate ? (
          <Card className="mt-5 p-5">
            <h2 className="text-heading-sm text-sand-900">
              {editing ? 'Edit category' : 'New category'}
            </h2>
            <div className="mt-4">
              <CategoryForm
                initial={editing ?? undefined}
                parentCandidates={parentCandidates}
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

        <div className="mt-6">
          <DataTable
            columns={columns}
            data={categories === null ? null : orderedRows}
            rowKey={(row) => row.category.id}
            error={error}
            onRetry={() => void load()}
            emptyTitle="No categories yet"
            emptyDescription="Create one to start adding products."
          />
        </div>
      </ResponsiveContainer>

      <ConfirmDialog
        open={confirmingDelete !== null}
        onClose={() => setConfirmingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete this category?"
        description={
          confirmingDelete
            ? `"${confirmingDelete.name}" will be permanently removed. Refused if it still has products — reassign or archive them first.`
            : ''
        }
        confirmLabel="Delete"
        destructive
      />
    </main>
  );
}
