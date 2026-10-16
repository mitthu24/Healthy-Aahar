'use client';

import { ApiError, type Role } from '@healthy-aahar/sdk';
import { Button, Card, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/** Cryptographically-fine-for-UI-only random password suggestion — the
 *  actual security boundary is server-side `assertPasswordStrength` /
 *  scrypt hashing; this just saves the admin from typing one by hand. Not
 *  used for "Generate temporary password" (employee detail page), which is
 *  a server-generated, server-hashed credential by design. */
function suggestPassword(): string {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) return '';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, '')
    .slice(0, 16);
}

export default function InviteEmployeePage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [email, setEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  // Default flow (Stage F): admin sets an initial password directly. The
  // setup-link flow (employee chooses their own password) remains fully
  // supported as an alternative — toggled here, never removed.
  const [useSetupLink, setUseSetupLink] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [invitedWithPassword, setInvitedWithPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void apiClient
      .listRoles()
      .then((r) => setRoles(r.data))
      .catch(() => setRoles([]));
  }, []);

  function toggleRole(id: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Enter an email address.');
      return;
    }
    if (!employeeCode.trim()) {
      setError('Enter an employee ID.');
      return;
    }
    if (!useSetupLink && password.trim().length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiClient.inviteAdminUser({
        email: email.trim(),
        employee_code: employeeCode.trim(),
        full_name: fullName,
        designation: designation || undefined,
        department: department || undefined,
        role_ids: selectedRoleIds,
        password: useSetupLink ? undefined : password.trim(),
      });
      if (result.password_setup_link) {
        setSetupLink(result.password_setup_link);
      } else {
        setInvitedWithPassword(fullName);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite this employee.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copySetupLink() {
    try {
      await navigator.clipboard.writeText(setupLink ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser — the link is still
      // visible and selectable, so this is a convenience failure only.
    }
  }

  if (invitedWithPassword) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-display text-heading-lg text-sand-900">Employee invited</h1>
        <Card className="mt-5 p-5">
          <p className="text-body-sm text-sand-700">
            <strong>{invitedWithPassword}</strong>&rsquo;s account was created with the password
            you set. Share it with them through a secure channel (not a public one) — they will
            be required to choose a new password the first time they sign in.
          </p>
          <div className="mt-5 flex gap-3">
            <a
              href="/employees"
              className="text-sand-0 inline-flex h-9 items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium transition-colors hover:bg-green-700"
            >
              Back to employees
            </a>
          </div>
        </Card>
      </main>
    );
  }

  if (setupLink) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-display text-heading-lg text-sand-900">Employee invited</h1>
        <Card className="mt-5 p-5">
          <p className="text-body-sm text-sand-700">
            Share this one-time setup link with <strong>{fullName}</strong> through a secure channel
            (not a public one). It expires in 7 days and can only be used once.
          </p>
          <p className="border-sand-200 bg-sand-50 text-body-sm mt-4 break-all rounded-md border p-3 font-mono">
            {setupLink}
          </p>
          <p className="text-caption text-sand-500 mt-3">
            This link will not be shown again — copy it now. It is never stored or logged.
          </p>
          <div className="mt-5 flex gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void copySetupLink()}
            >
              {copied ? 'Copied' : 'Copy setup link'}
            </Button>
            <a
              href="/employees"
              className="text-sand-0 inline-flex h-9 items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium transition-colors hover:bg-green-700"
            >
              Back to employees
            </a>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="font-display text-heading-lg text-sand-900">Invite an employee</h1>

      <Card className="mt-5 p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="emp-email">Email</FieldLabel>
            <Input
              id="emp-email"
              type="email"
              required
              className="mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="emp-employee-code">Employee ID</FieldLabel>
            <Input
              id="emp-employee-code"
              required
              className="mt-1"
              placeholder="e.g. EMP-014"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="emp-name">Full name</FieldLabel>
            <Input
              id="emp-name"
              required
              className="mt-1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="emp-designation">Job title (optional)</FieldLabel>
              <Input
                id="emp-designation"
                className="mt-1"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="emp-department">Department (optional)</FieldLabel>
              <Input
                id="emp-department"
                className="mt-1"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
          </div>

          <div className="border-sand-100 rounded-md border p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useSetupLink}
                onChange={(e) => setUseSetupLink(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-body-sm text-sand-800">
                Send a setup link instead (the employee chooses their own password)
              </span>
            </label>

            {useSetupLink ? (
              <p className="text-caption text-sand-500 mt-2">
                A one-time link will be issued after creating this account for you to share
                securely. More private — you never see their password.
              </p>
            ) : (
              <div className="mt-3">
                <FieldLabel htmlFor="emp-password">Initial password</FieldLabel>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="emp-password"
                    type="text"
                    required={!useSetupLink}
                    minLength={10}
                    className="flex-1"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPassword(suggestPassword())}
                  >
                    Suggest
                  </Button>
                </div>
                <p className="text-caption text-sand-500 mt-1">
                  At least 10 characters. The employee must choose a new password the first time
                  they sign in — this one stops working after that.
                </p>
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="emp-roles">Roles</FieldLabel>
            <div id="emp-roles" className="mt-2 space-y-2">
              {roles === null ? (
                <p className="text-caption text-sand-400">Loading roles…</p>
              ) : roles.length === 0 ? (
                <p className="text-caption text-danger-600">
                  No roles exist yet — create one on the Roles page first.
                </p>
              ) : (
                roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={() => toggleRole(role.id)}
                      className="h-4 w-4"
                    />
                    <span className="text-body-sm text-sand-800">{role.name}</span>
                    {role.key === 'SUPER_ADMIN' ? (
                      <span className="text-caption text-sand-400">(full access)</span>
                    ) : null}
                  </label>
                ))
              )}
            </div>
          </div>

          <FieldError>{error}</FieldError>

          <Button
            type="submit"
            size="lg"
            isLoading={isSubmitting}
            disabled={selectedRoleIds.length === 0}
          >
            Send invitation
          </Button>
        </form>
      </Card>
    </main>
  );
}
