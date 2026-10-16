'use client';

import {
  ApiError,
  type AdminCategoryDto,
  type AdminProductDto,
  type AdminUnitDto,
  type AdminVariantDto,
} from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  FieldError,
  FieldLabel,
  Input,
  Select,
  Skeleton,
  type BadgeTone,
} from '@healthy-aahar/ui';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';
import { uploadWithProgress } from '@/lib/upload-with-progress';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'ARCHIVED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function AddVariantForm({
  productId,
  unitOptions,
  onAdded,
}: {
  productId: string;
  unitOptions: { value: string; label: string }[];
  onAdded: () => void;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState(unitOptions[0]?.value ?? '');
  const [unitValue, setUnitValue] = useState('500');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [stock, setStock] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createVariant(productId, {
        sku,
        name,
        unit,
        unit_value: Number(unitValue),
        price_paise: Math.round(Number(price) * 100),
        mrp_paise: mrp ? Math.round(Number(mrp) * 100) : undefined,
        tax_rate_bps: taxRate ? Math.round(Number(taxRate) * 100) : undefined,
        initial_quantity_on_hand: Number(stock) || 0,
      });
      setSku('');
      setName('');
      setPrice('');
      setMrp('');
      setTaxRate('');
      setStock('0');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this variant.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <FieldLabel htmlFor="v-sku">SKU</FieldLabel>
        <Input
          id="v-sku"
          required
          className="mt-1"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="v-name">Display name</FieldLabel>
        <Input
          id="v-name"
          required
          placeholder="500g pack"
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel htmlFor="v-unit-value">Unit value</FieldLabel>
          <Input
            id="v-unit-value"
            required
            type="number"
            min="0"
            step="0.01"
            className="mt-1"
            value={unitValue}
            onChange={(e) => setUnitValue(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <FieldLabel htmlFor="v-unit">Unit</FieldLabel>
          <Select
            id="v-unit"
            className="mt-1"
            value={unit}
            options={unitOptions}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="v-price">Price (₹)</FieldLabel>
        <Input
          id="v-price"
          required
          type="number"
          min="0"
          step="0.01"
          className="mt-1"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="v-mrp">MRP (₹, optional)</FieldLabel>
        <Input
          id="v-mrp"
          type="number"
          min="0"
          step="0.01"
          className="mt-1"
          value={mrp}
          onChange={(e) => setMrp(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="v-tax-rate">Tax rate (%, optional)</FieldLabel>
        <Input
          id="v-tax-rate"
          type="number"
          min="0"
          max="100"
          step="0.01"
          className="mt-1"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="v-stock">Initial stock</FieldLabel>
        <Input
          id="v-stock"
          type="number"
          min="0"
          className="mt-1"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
      </div>

      <div className="col-span-full">
        <FieldError>{error}</FieldError>
        <Button type="submit" size="sm" isLoading={isSubmitting} className="mt-2">
          Add variant
        </Button>
      </div>
    </form>
  );
}

function EditVariantForm({
  variant,
  unitOptions,
  onSaved,
  onCancel,
}: {
  variant: AdminVariantDto;
  unitOptions: { value: string; label: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(variant.name);
  const [unit, setUnit] = useState(variant.unit);
  const [unitValue, setUnitValue] = useState(String(variant.unit_value));
  const [price, setPrice] = useState(String(variant.price.amount_paise / 100));
  const [mrp, setMrp] = useState(variant.mrp ? String(variant.mrp.amount_paise / 100) : '');
  const [taxRate, setTaxRate] = useState(String(variant.tax_rate_bps / 100));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.updateVariant(variant.id, {
        name,
        unit,
        unit_value: Number(unitValue),
        price_paise: Math.round(Number(price) * 100),
        mrp_paise: mrp ? Math.round(Number(mrp) * 100) : null,
        tax_rate_bps: taxRate ? Math.round(Number(taxRate) * 100) : 0,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this variant.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <FieldLabel htmlFor={`edit-v-name-${variant.id}`}>Display name</FieldLabel>
        <Input
          id={`edit-v-name-${variant.id}`}
          required
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel htmlFor={`edit-v-unit-value-${variant.id}`}>Unit value</FieldLabel>
          <Input
            id={`edit-v-unit-value-${variant.id}`}
            required
            type="number"
            min="0"
            step="0.01"
            className="mt-1"
            value={unitValue}
            onChange={(e) => setUnitValue(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <FieldLabel htmlFor={`edit-v-unit-${variant.id}`}>Unit</FieldLabel>
          <Select
            id={`edit-v-unit-${variant.id}`}
            className="mt-1"
            value={unit}
            // The variant's current unit may have since been deactivated
            // (still valid to KEEP, per Stage F — "existing products
            // continue to display their previously assigned units") —
            // included explicitly so editing other fields never silently
            // forces a different unit onto it.
            options={
              unitOptions.some((o) => o.value === variant.unit)
                ? unitOptions
                : [{ value: variant.unit, label: `${variant.unit} (inactive)` }, ...unitOptions]
            }
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`edit-v-price-${variant.id}`}>Price (₹)</FieldLabel>
        <Input
          id={`edit-v-price-${variant.id}`}
          required
          type="number"
          min="0"
          step="0.01"
          className="mt-1"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor={`edit-v-mrp-${variant.id}`}>MRP (₹, optional)</FieldLabel>
        <Input
          id={`edit-v-mrp-${variant.id}`}
          type="number"
          min="0"
          step="0.01"
          className="mt-1"
          value={mrp}
          onChange={(e) => setMrp(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor={`edit-v-tax-rate-${variant.id}`}>Tax rate (%)</FieldLabel>
        <Input
          id={`edit-v-tax-rate-${variant.id}`}
          type="number"
          min="0"
          max="100"
          step="0.01"
          className="mt-1"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
        />
      </div>
      <div className="col-span-full flex items-center gap-2">
        <FieldError>{error}</FieldError>
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function VariantRow({
  variant,
  unitOptions,
  onChanged,
}: {
  variant: AdminVariantDto;
  unitOptions: { value: string; label: string }[];
  onChanged: () => void;
}) {
  const [editingStock, setEditingStock] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stockValue, setStockValue] = useState(String(variant.inventory?.quantity_on_hand ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function saveStock() {
    setError(null);
    setIsBusy(true);
    try {
      await apiClient.setVariantStock(variant.id, { quantity_on_hand: Number(stockValue) });
      setEditingStock(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update stock.');
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    try {
      await apiClient.deleteVariant(variant.id);
      setConfirmingDelete(false);
      onChanged();
    } catch (err) {
      setConfirmingDelete(false);
      setDeleteError(
        err instanceof ApiError && err.code === 'VARIANT_REFERENCED_BY_ORDERS'
          ? 'This variant has order or inventory history and cannot be deleted — mark it Discontinued instead.'
          : err instanceof ApiError
            ? err.message
            : 'Could not delete this variant.',
      );
    }
  }

  if (editingDetails) {
    return (
      <Card className="p-4">
        <EditVariantForm
          variant={variant}
          unitOptions={unitOptions}
          onSaved={() => {
            setEditingDetails(false);
            onChanged();
          }}
          onCancel={() => setEditingDetails(false)}
        />
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-body-sm text-sand-900 font-semibold">{variant.name}</p>
          <p className="text-caption text-sand-600">
            SKU {variant.sku} · {variant.unit_value}
            {variant.unit}
          </p>
          <p className="text-body-sm tabular mt-1">
            {variant.price.display}
            {variant.mrp && variant.mrp.amount_paise > variant.price.amount_paise ? (
              <span className="text-caption text-sand-400 ml-2 line-through">
                {variant.mrp.display}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={variant.availability === 'AVAILABLE' ? 'success' : 'danger'}>
            {variant.availability}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => setEditingDetails(true)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="border-sand-100 mt-3 border-t pt-3">
        {editingStock ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <FieldLabel htmlFor={`stock-${variant.id}`}>On-hand stock</FieldLabel>
              <Input
                id={`stock-${variant.id}`}
                type="number"
                min="0"
                className="mt-1 w-32"
                value={stockValue}
                onChange={(e) => setStockValue(e.target.value)}
              />
            </div>
            <Button size="sm" isLoading={isBusy} onClick={saveStock}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditingStock(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-body-sm text-sand-700">
              On hand:{' '}
              <span className="tabular font-medium">
                {variant.inventory?.quantity_on_hand ?? '—'}
              </span>
              {variant.inventory ? (
                <span className="text-caption text-sand-500 ml-2">
                  ({variant.inventory.quantity_available} available,{' '}
                  {variant.inventory.quantity_reserved} reserved)
                </span>
              ) : null}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setEditingStock(true)}>
              Update stock
            </Button>
          </div>
        )}
        {error ? <p className="text-caption text-danger-600 mt-2">{error}</p> : null}
        {deleteError ? <p className="text-caption text-danger-600 mt-2">{deleteError}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        title="Delete this variant?"
        description={`"${variant.name}" will be permanently removed. This cannot be undone. If it has ever been ordered or had stock adjusted, deletion will be refused — discontinue it instead.`}
        confirmLabel="Delete"
        destructive
      />
    </Card>
  );
}

function AddImageForm({ productId, onAdded }: { productId: string; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.addProductImage(productId, { url, alt_text: altText || undefined });
      setUrl('');
      setAltText('');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this image.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <FieldLabel htmlFor="img-url">Image URL (https, .jpg/.png/.webp/.avif)</FieldLabel>
        <Input
          id="img-url"
          required
          type="url"
          className="mt-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="w-40">
        <FieldLabel htmlFor="img-alt">Alt text</FieldLabel>
        <Input
          id="img-alt"
          className="mt-1"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" isLoading={isSubmitting}>
        Add image
      </Button>
      {error ? <p className="text-caption text-danger-600 w-full">{error}</p> : null}
    </form>
  );
}

/**
 * Device-upload counterpart to `AddImageForm` (PHASE 05). Selects a file
 * (click-to-browse or drag-and-drop), shows a preview before anything
 * uploads, then: request a presigned URL -> PUT the file directly to
 * object storage (with progress) -> confirm. The product's image list
 * only updates once confirm succeeds — a failed or abandoned upload never
 * leaves a broken image visible.
 */
function UploadImageForm({ productId, onAdded }: { productId: string; onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectFile(candidate: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!candidate) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(candidate.type)) {
      setError('Unsupported file type. Use JPEG, PNG, WebP, or AVIF.');
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFile(candidate);
    setPreviewUrl(URL.createObjectURL(candidate));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0] ?? null);
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setIsUploading(true);
    setProgress(0);
    try {
      const ticket = await apiClient.requestProductImageUpload(productId, {
        content_type: file.type,
      });
      if (file.size > ticket.max_bytes) {
        throw new Error(
          `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ` +
            `${(ticket.max_bytes / 1024 / 1024).toFixed(1)} MB.`,
        );
      }

      await uploadWithProgress(ticket.upload_url, file, setProgress);
      await apiClient.confirmProductImageUpload(productId, ticket.image_id);

      selectFile(null);
      onAdded();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Upload failed. Please try again.',
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
          isDragging ? 'border-green-500 bg-green-50' : 'border-sand-200 bg-sand-0'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          className="sr-only"
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
        />
        {previewUrl ? (
          <div className="relative h-24 w-24 overflow-hidden rounded-md">
            {/* Local blob preview — next/image can't optimize a blob: URL. */}
            <img src={previewUrl} alt="Selected preview" className="h-full w-full object-cover" />
          </div>
        ) : (
          <>
            <p className="text-body-sm text-sand-700">
              Drag an image here, or <span className="font-medium text-green-700">browse</span>
            </p>
            <p className="text-caption text-sand-400">JPEG, PNG, WebP, or AVIF</p>
          </>
        )}
      </div>

      {file ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-caption text-sand-600 min-w-0 flex-1 truncate">
            {file.name} ({(file.size / 1024).toFixed(0)} KB)
          </p>
          <Button type="button" size="sm" isLoading={isUploading} onClick={() => void upload()}>
            Upload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isUploading}
            onClick={() => selectFile(null)}
          >
            Remove
          </Button>
        </div>
      ) : null}

      {isUploading ? (
        <div
          className="bg-sand-100 h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-green-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
    </div>
  );
}

function EditProductForm({
  product,
  categories,
  onSaved,
  onCancel,
}: {
  product: AdminProductDto;
  categories: AdminCategoryDto[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [categoryId, setCategoryId] = useState(product.category.id);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.updateProduct(product.id, {
        name,
        description: description || null,
        category_id: categoryId,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this product.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="mt-4 p-4">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <FieldLabel htmlFor="edit-p-name">Name</FieldLabel>
          <Input
            id="edit-p-name"
            required
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="edit-p-category">Category</FieldLabel>
          <Select
            id="edit-p-category"
            className="mt-1"
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => setCategoryId(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="edit-p-description">Description</FieldLabel>
          <textarea
            id="edit-p-description"
            className="border-sand-200 bg-sand-0 text-body-sm mt-1 w-full rounded-md border p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <FieldError>{error}</FieldError>
          <Button type="submit" size="sm" isLoading={isSubmitting}>
            Save
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<AdminProductDto | null>(null);
  const [categories, setCategories] = useState<AdminCategoryDto[]>([]);
  const [units, setUnits] = useState<AdminUnitDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setProduct(await apiClient.getAdminProduct(params.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PRODUCT_NOT_FOUND'
          ? 'Product not found.'
          : 'Could not load this product.',
      );
    }
  }

  useEffect(() => {
    void load();
    void apiClient
      .listAdminCategories({ limit: 100 })
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
    void apiClient
      .listUnits({ active_only: true })
      .then((r) => setUnits(r.data))
      .catch(() => setUnits([]));
  }, [params.id]);

  async function changeStatus(status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') {
    setStatusError(null);
    setIsChangingStatus(true);
    try {
      setProduct(await apiClient.setProductStatus(params.id, status));
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : 'Could not change status.');
    } finally {
      setIsChangingStatus(false);
      setConfirmingArchive(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    try {
      await apiClient.deleteProduct(params.id);
      setConfirmingDelete(false);
      router.push('/products');
    } catch (err) {
      setConfirmingDelete(false);
      setDeleteError(
        err instanceof ApiError && err.code === 'PRODUCT_REFERENCED_BY_ORDERS'
          ? 'This product has order or inventory history and cannot be deleted — archive it instead.'
          : err instanceof ApiError
            ? err.message
            : 'Could not delete this product.',
      );
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!product) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  const unitOptions = units.map((u) => ({ value: u.code, label: u.label }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 pb-16">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg text-sand-900">{product.name}</h1>
          <p className="text-body-sm text-sand-600 mt-1">
            /{product.slug} · {product.category.name}
          </p>
        </div>
        <Badge tone={statusTone(product.status)}>{product.status}</Badge>
      </div>

      {statusError ? <p className="text-body-sm text-danger-600 mt-3">{statusError}</p> : null}
      {deleteError ? <p className="text-body-sm text-danger-600 mt-3">{deleteError}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {product.status !== 'ACTIVE' ? (
          <Button
            size="sm"
            isLoading={isChangingStatus}
            onClick={() => void changeStatus('ACTIVE')}
          >
            Publish
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            isLoading={isChangingStatus}
            onClick={() => void changeStatus('INACTIVE')}
          >
            Unpublish
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setIsEditingProduct((v) => !v)}>
          {isEditingProduct ? 'Cancel edit' : 'Edit'}
        </Button>
        {product.status !== 'ARCHIVED' ? (
          <Button
            size="sm"
            variant="danger"
            isLoading={isChangingStatus}
            onClick={() => setConfirmingArchive(true)}
          >
            Archive
          </Button>
        ) : null}
        <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
          Delete
        </Button>
      </div>

      {isEditingProduct ? (
        <EditProductForm
          product={product}
          categories={categories}
          onSaved={() => {
            setIsEditingProduct(false);
            void load();
          }}
          onCancel={() => setIsEditingProduct(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmingArchive}
        onClose={() => setConfirmingArchive(false)}
        onConfirm={() => changeStatus('ARCHIVED')}
        title="Archive this product?"
        description={`"${product.name}" will be hidden from the customer catalogue. You can unpublish or re-publish it later — archiving never deletes it.`}
        confirmLabel="Archive"
        destructive
      />

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        title="Delete this product?"
        description={`"${product.name}" and its variants will be permanently removed. This cannot be undone. If it has ever been ordered, deletion will be refused — archive it instead.`}
        confirmLabel="Delete"
        destructive
      />

      <section className="mt-8">
        <h2 className="text-heading-sm text-sand-900">Images</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {product.images.map((image) => (
            <div key={image.id} className="relative">
              <div className="bg-sand-100 relative h-24 w-24 overflow-hidden rounded-md">
                <Image
                  src={image.url}
                  alt={image.alt_text ?? ''}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  await apiClient.removeProductImage(product.id, image.id);
                  void load();
                }}
                className="bg-danger-600 text-sand-0 absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <Card className="mt-3 p-4">
          <h3 className="text-body-sm text-sand-900 font-medium">Upload from device</h3>
          <div className="mt-3">
            <UploadImageForm productId={product.id} onAdded={() => void load()} />
          </div>
        </Card>
        <Card className="mt-3 p-4">
          <h3 className="text-body-sm text-sand-900 font-medium">
            Or link an already-hosted image
          </h3>
          <div className="mt-3">
            <AddImageForm productId={product.id} onAdded={() => void load()} />
          </div>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-heading-sm text-sand-900">Variants</h2>
        <div className="mt-3 space-y-3">
          {product.variants.length === 0 ? (
            <p className="text-body-sm text-danger-600">
              No variants yet — add at least one with a price before publishing.
            </p>
          ) : (
            product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                unitOptions={unitOptions}
                onChanged={() => void load()}
              />
            ))
          )}
        </div>
        <Card className="mt-4 p-4">
          <h3 className="text-body-sm text-sand-900 font-medium">Add a variant</h3>
          <div className="mt-3">
            {unitOptions.length === 0 ? (
              <p className="text-caption text-danger-600">
                No active units configured —{' '}
                <a href="/settings/units" className="text-green-700 hover:underline">
                  add one in Settings
                </a>{' '}
                before adding a variant.
              </p>
            ) : (
              <AddVariantForm
                productId={product.id}
                unitOptions={unitOptions}
                onAdded={() => void load()}
              />
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
