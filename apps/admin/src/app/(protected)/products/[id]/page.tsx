'use client';

import { ApiError, type AdminProductDto, type AdminVariantDto } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  type BadgeTone,
} from '@healthy-aahar/ui';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

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

function AddVariantForm({ productId, onAdded }: { productId: string; onAdded: () => void }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('g');
  const [unitValue, setUnitValue] = useState('500');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
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
        initial_quantity_on_hand: Number(stock) || 0,
      });
      setSku('');
      setName('');
      setPrice('');
      setMrp('');
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
          <Input
            id="v-unit"
            required
            className="mt-1"
            value={unit}
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

function VariantRow({ variant, onChanged }: { variant: AdminVariantDto; onChanged: () => void }) {
  const [editingStock, setEditingStock] = useState(false);
  const [stockValue, setStockValue] = useState(String(variant.inventory?.quantity_on_hand ?? 0));
  const [error, setError] = useState<string | null>(null);
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
        <Badge tone={variant.availability === 'AVAILABLE' ? 'success' : 'danger'}>
          {variant.availability}
        </Badge>
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
      </div>
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

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<AdminProductDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

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
        {product.status !== 'ARCHIVED' ? (
          <Button
            size="sm"
            variant="danger"
            isLoading={isChangingStatus}
            onClick={() => void changeStatus('ARCHIVED')}
          >
            Archive
          </Button>
        ) : null}
      </div>

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
          <AddImageForm productId={product.id} onAdded={() => void load()} />
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
              <VariantRow key={variant.id} variant={variant} onChanged={() => void load()} />
            ))
          )}
        </div>
        <Card className="mt-4 p-4">
          <h3 className="text-body-sm text-sand-900 font-medium">Add a variant</h3>
          <div className="mt-3">
            <AddVariantForm productId={product.id} onAdded={() => void load()} />
          </div>
        </Card>
      </section>
    </main>
  );
}
