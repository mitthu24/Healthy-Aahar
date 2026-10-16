'use client';

import { ApiError, type Role } from '@healthy-aahar/sdk';
import { Button, Card, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

export default function InviteEmployeePage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [email, setEmail] = useState('');
  const [loginId, setLoginId] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [createdLoginId, setCreatedLoginId] = useState<string | null>(null);
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
    if (!email.trim() && !loginId.trim()) {
      setError('Enter an email or a login ID.');
      return;
    }
    if (!employeeCode.trim()) {
      setError('Enter an employee ID.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await apiClient.inviteAdminUser({
        email: email.trim() || undefined,
        login_id: loginId.trim() || undefined,
        employee_code: employeeCode.trim(),
        full_name: fullName,
        designation: designation || undefined,
        department: department || undefined,
        role_ids: selectedRoleIds,
      });
      setCreatedLoginId(result.login_id);
      setSetupLink(result.password_setup_link);
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

  if (setupLink) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-display text-heading-lg text-sand-900">Employee invited</h1>
        <Card className="mt-5 p-5">
          {createdLoginId ? (
            <div className="mb-4">
              <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
                Login ID
              </p>
              <p className="border-sand-200 bg-sand-50 text-body-sm mt-1 break-all rounded-md border p-3 font-mono">
                {createdLoginId}
              </p>
              <p className="text-caption text-sand-500 mt-1">
                {fullName} will sign in with this login ID and the password they choose below.
              </p>
            </div>
          ) : null}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="emp-email">Email (optional)</FieldLabel>
              <Input
                id="emp-email"
                type="email"
                className="mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="emp-login-id">Login ID (optional)</FieldLabel>
              <Input
                id="emp-login-id"
                className="mt-1"
                placeholder="e.g. priya.sharma"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
              />
            </div>
          </div>
          <p className="text-caption text-sand-500 -mt-2">
            Provide an email, a login ID, or both — at least one is required so this employee can
            sign in.
          </p>
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
