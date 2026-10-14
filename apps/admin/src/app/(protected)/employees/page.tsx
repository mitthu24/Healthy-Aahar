'use client';

import type { AdminUser } from '@healthy-aahar/sdk';
import { Badge, Card, EmptyState, ErrorState, Input, Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Employee directory (Phase 05). "Employee" in the product sense is
 * `AdminUser` in the data model — the invite/role/deactivate machinery
 * already existed from Phase 03/04's RBAC work; this page is the first UI
 * for it.
 */
export default function EmployeesPage() {
  const [employees, setEmployees] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  async function load(query: string) {
    setError(null);
    try {
      setEmployees((await apiClient.listAdminUsers({ q: query || undefined })).data);
    } catch {
      setError('Could not load employees.');
    }
  }

  useEffect(() => {
    const id = setTimeout(() => void load(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  if (error) return <ErrorState message={error} onRetry={() => void load(q)} />;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-heading-lg text-sand-900">Employees</h1>
        <Link
          href="/employees/new"
          className="text-sand-0 inline-flex h-9 items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium transition-colors hover:bg-green-700 active:bg-green-800"
        >
          Invite employee
        </Link>
      </div>

      <div className="mt-4 max-w-xs">
        <Input
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search employees"
        />
      </div>

      <div className="mt-6 space-y-3">
        {employees === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : employees.length === 0 ? (
          <EmptyState
            title="No employees found"
            description={q ? 'Try a different search.' : 'Invite your first team member.'}
          />
        ) : (
          employees.map((employee) => (
            <Link key={employee.id} href={`/employees/${employee.id}`}>
              <Card className="flex items-center justify-between p-4 transition-colors hover:border-green-300">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-body-sm text-sand-900 font-semibold">{employee.full_name}</p>
                    {employee.is_super_admin ? <Badge tone="success">Super Admin</Badge> : null}
                    {employee.deactivated ? <Badge tone="danger">Deactivated</Badge> : null}
                  </div>
                  <p className="text-caption text-sand-600 mt-0.5">
                    {employee.email ?? 'No email on file'}
                    {employee.designation ? ` · ${employee.designation}` : ''}
                    {employee.department ? ` · ${employee.department}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {employee.roles.map((role) => (
                    <Badge key={role} tone="neutral">
                      {role}
                    </Badge>
                  ))}
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
