'use client';

import { ApiError, type DeliveryPartnerDto } from '@healthy-aahar/sdk';
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

/**
 * Delivery partner directory (Phase 06). A partner is an AdminUser with the
 * DELIVERY_PARTNER role — this page is admin-side account management
 * (create/suspend/reactivate); the partner's own duty toggle and delivery
 * actions live in the separate `apps/delivery` app.
 */
export default function DeliveryPartnersPage() {
  const [partners, setPartners] = useState<DeliveryPartnerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);

  async function load(query: string) {
    setError(null);
    try {
      setPartners((await apiClient.listDeliveryPartners({ q: query || undefined })).data);
    } catch {
      setError('Could not load delivery partners.');
    }
  }

  useEffect(() => {
    const id = setTimeout(() => void load(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  async function toggleSuspend(partner: DeliveryPartnerDto) {
    try {
      if (partner.deactivated) {
        await apiClient.reactivateDeliveryPartner(partner.id);
      } else {
        await apiClient.suspendDeliveryPartner(partner.id);
      }
      await load(q);
    } catch {
      setError('Could not update this partner.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load(q)} />;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-heading-lg text-sand-900">Delivery Partners</h1>
        {!showCreate ? (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            Add delivery partner
          </Button>
        ) : null}
      </div>

      {setupLink ? (
        <Card className="bg-success-50 mt-4 border-none p-4">
          <p className="text-body-sm text-sand-800 font-medium">
            Partner created. Share this one-time setup link with them — it will not be shown again:
          </p>
          <p className="text-caption text-sand-700 mt-1 break-all font-mono">{setupLink}</p>
        </Card>
      ) : null}

      {showCreate ? (
        <Card className="mt-4 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading-sm text-sand-900">New delivery partner</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
          <CreateDeliveryPartnerForm
            onCreated={(link) => {
              setShowCreate(false);
              setSetupLink(link);
              void load(q);
            }}
          />
        </Card>
      ) : null}

      <div className="mt-4 max-w-xs">
        <Input
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search delivery partners"
        />
      </div>

      <div className="mt-6 space-y-3">
        {partners === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : partners.length === 0 ? (
          <EmptyState
            title="No delivery partners found"
            description={q ? 'Try a different search.' : 'Add your first delivery partner.'}
          />
        ) : (
          partners.map((partner) => (
            <Card key={partner.id} className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body-sm text-sand-900 font-semibold">{partner.full_name}</p>
                  <Badge tone={partner.duty_status === 'ON_DUTY' ? 'success' : 'neutral'}>
                    {partner.duty_status === 'ON_DUTY' ? 'On duty' : 'Off duty'}
                  </Badge>
                  {partner.deactivated ? <Badge tone="danger">Suspended</Badge> : null}
                  {partner.active_delivery_count > 0 ? (
                    <Badge tone="neutral">{partner.active_delivery_count} active</Badge>
                  ) : null}
                </div>
                <p className="text-caption text-sand-600 mt-0.5">
                  {partner.email ?? 'No email on file'}
                  {partner.vehicle_type ? ` · ${partner.vehicle_type}` : ''}
                  {partner.vehicle_number ? ` (${partner.vehicle_number})` : ''}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void toggleSuspend(partner)}>
                {partner.deactivated ? 'Reactivate' : 'Suspend'}
              </Button>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}

function CreateDeliveryPartnerForm({ onCreated }: { onCreated: (setupLink: string) => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await apiClient.createDeliveryPartner({
        email,
        full_name: fullName,
        employee_code: employeeCode || undefined,
        vehicle_type: vehicleType || undefined,
        vehicle_number: vehicleNumber || undefined,
      });
      setEmail('');
      setFullName('');
      setEmployeeCode('');
      setVehicleType('');
      setVehicleNumber('');
      onCreated(created.password_setup_link);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not create this delivery partner. Has the DELIVERY_PARTNER role been seeded?',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="partner-name">Full name</FieldLabel>
          <Input
            id="partner-name"
            required
            className="mt-1"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="partner-email">Email</FieldLabel>
          <Input
            id="partner-email"
            type="email"
            required
            className="mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel htmlFor="partner-employee-code">Employee ID (optional)</FieldLabel>
          <Input
            id="partner-employee-code"
            className="mt-1"
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="partner-vehicle-type">Vehicle type (optional)</FieldLabel>
          <Input
            id="partner-vehicle-type"
            className="mt-1"
            placeholder="Bike, scooter…"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="partner-vehicle-number">Vehicle number (optional)</FieldLabel>
          <Input
            id="partner-vehicle-number"
            className="mt-1"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
          />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" isLoading={isSubmitting}>
        Create delivery partner
      </Button>
    </form>
  );
}
