'use client';

import { ApiError, type AdminUser, type Role } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  FieldLabel,
  Input,
  Skeleton,
} from '@healthy-aahar/ui';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

function DetailsForm({ employee, onSaved }: { employee: AdminUser; onSaved: () => void }) {
  const [fullName, setFullName] = useState(employee.full_name);
  const [employeeCode, setEmployeeCode] = useState(employee.employee_code ?? '');
  const [designation, setDesignation] = useState(employee.designation ?? '');
  const [department, setDepartment] = useState(employee.department ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.updateAdminUser(employee.id, {
        full_name: fullName,
        employee_code: employeeCode.trim() || undefined,
        designation: designation || undefined,
        department: department || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these details.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <FieldLabel htmlFor="edit-name">Full name</FieldLabel>
        <Input
          id="edit-name"
          required
          className="mt-1"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="edit-employee-code">Employee ID</FieldLabel>
        <Input
          id="edit-employee-code"
          className="mt-1"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="edit-designation">Job title</FieldLabel>
          <Input
            id="edit-designation"
            className="mt-1"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="edit-department">Department</FieldLabel>
          <Input
            id="edit-department"
            className="mt-1"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
      <Button type="submit" size="sm" isLoading={isSubmitting}>
        Save details
      </Button>
    </form>
  );
}

function RolesForm({ employee, onSaved }: { employee: AdminUser; onSaved: () => void }) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void apiClient.listRoles().then((r) => {
      setRoles(r.data);
      setSelected(r.data.filter((role) => employee.roles.includes(role.key)).map((r2) => r2.id));
    });
  }, [employee.roles]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function save() {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.setAdminUserRoles(employee.id, selected);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'CANNOT_MODIFY_OWN_ROLES'
            ? 'You cannot change your own roles — ask another Super Admin.'
            : err.message
          : 'Could not update roles.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (roles === null) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <label key={role.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(role.id)}
            onChange={() => toggle(role.id)}
            className="h-4 w-4"
          />
          <span className="text-body-sm text-sand-800">{role.name}</span>
        </label>
      ))}
      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
      <Button size="sm" isLoading={isSubmitting} onClick={() => void save()}>
        Save roles
      </Button>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetEmailStatus, setResetEmailStatus] = useState<
    'SENT' | 'SKIPPED' | 'FAILED' | null
  >(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [tempPasswordCopied, setTempPasswordCopied] = useState(false);
  const [confirmingTempPassword, setConfirmingTempPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      setEmployee(await apiClient.getAdminUser(params.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? 'Employee not found.'
          : 'Could not load this employee.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function onResetPassword() {
    setActionError(null);
    setResetLink(null);
    setResetEmailStatus(null);
    setIsBusy(true);
    try {
      const result = await apiClient.resetAdminUserPassword(params.id);
      setResetLink(result.password_setup_link);
      setResetEmailStatus(result.email_status);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not issue a reset link.');
    } finally {
      setIsBusy(false);
    }
  }

  async function onGenerateTemporaryPassword() {
    setActionError(null);
    setTemporaryPassword(null);
    setTempPasswordCopied(false);
    setConfirmingTempPassword(false);
    setIsBusy(true);
    try {
      const result = await apiClient.generateTemporaryPassword(params.id);
      setTemporaryPassword(result.temporary_password);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.code === 'CANNOT_MANAGE_SUPER_ADMIN'
            ? 'Only a Super Admin may generate a temporary password for another Super Admin.'
            : err.message
          : 'Could not generate a temporary password.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function copyTemporaryPassword() {
    try {
      await navigator.clipboard.writeText(temporaryPassword ?? '');
      setTempPasswordCopied(true);
      setTimeout(() => setTempPasswordCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the password is still visible and
      // selectable, so this is a convenience failure only.
    }
  }

  async function onToggleActive() {
    setActionError(null);
    setIsBusy(true);
    try {
      if (employee?.deactivated) {
        await apiClient.reactivateAdminUser(params.id);
      } else {
        await apiClient.deactivateAdminUser(params.id);
      }
      void load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.code === 'CANNOT_DEACTIVATE_SELF'
            ? 'You cannot deactivate your own account.'
            : err.code === 'LAST_SUPER_ADMIN'
              ? 'This is the last active Super Admin — assign another one first.'
              : err.message
          : 'Could not update this account.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!employee) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 pb-16">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg text-sand-900">{employee.full_name}</h1>
          <p className="text-body-sm text-sand-600 mt-1">
            {[
              employee.email,
              employee.login_id ? `Login ID: ${employee.login_id}` : null,
              employee.employee_code ? `Employee ID: ${employee.employee_code}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No email or login ID on file'}
          </p>
        </div>
        <div className="flex gap-2">
          {employee.is_super_admin ? <Badge tone="success">Super Admin</Badge> : null}
          {employee.deactivated ? <Badge tone="danger">Deactivated</Badge> : null}
        </div>
      </div>

      {actionError ? <p className="text-body-sm text-danger-600 mt-3">{actionError}</p> : null}

      {resetLink ? (
        <Card className="mt-4 p-4">
          <p className="text-body-sm text-sand-700">
            {resetEmailStatus === 'SENT'
              ? 'Reset email sent. The link below is also shown as a fallback — not shown again.'
              : resetEmailStatus === 'FAILED'
                ? 'The reset email could not be sent — share this link securely instead.'
                : 'Email sending is not configured in this environment — share this one-time link securely instead:'}
          </p>
          <p className="border-sand-200 bg-sand-50 text-caption mt-2 break-all rounded-md border p-2 font-mono">
            {resetLink}
          </p>
        </Card>
      ) : null}

      {temporaryPassword ? (
        <Card className="mt-4 p-4">
          <p className="text-body-sm text-sand-700">
            Temporary password — share it securely, not shown again. The employee must change it
            at first sign-in; every existing session for this account has been signed out.
          </p>
          <p className="border-sand-200 bg-sand-50 text-body-md mt-2 break-all rounded-md border p-2 font-mono">
            {temporaryPassword}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => void copyTemporaryPassword()}
          >
            {tempPasswordCopied ? 'Copied' : 'Copy password'}
          </Button>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          isLoading={isBusy}
          onClick={() => void onResetPassword()}
        >
          Send password reset link
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isLoading={isBusy}
          onClick={() => setConfirmingTempPassword(true)}
        >
          Generate temporary password
        </Button>
        <Button
          size="sm"
          variant={employee.deactivated ? 'secondary' : 'danger'}
          isLoading={isBusy}
          onClick={() => void onToggleActive()}
        >
          {employee.deactivated ? 'Reactivate account' : 'Deactivate account'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingTempPassword}
        onClose={() => setConfirmingTempPassword(false)}
        onConfirm={onGenerateTemporaryPassword}
        title="Generate a temporary password?"
        description={`This immediately replaces ${employee.full_name}'s current password and signs them out of every active session. They must choose a new password the first time they sign in with it.`}
        confirmLabel="Generate"
        destructive
      />

      <section className="mt-8">
        <h2 className="text-heading-sm text-sand-900">Details</h2>
        <Card className="mt-3 p-5">
          <DetailsForm employee={employee} onSaved={() => void load()} />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-heading-sm text-sand-900">Roles</h2>
        <Card className="mt-3 p-5">
          <RolesForm employee={employee} onSaved={() => void load()} />
        </Card>
      </section>
    </main>
  );
}
