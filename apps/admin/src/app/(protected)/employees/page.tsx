'use client';

import type { AdminUser } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  PageHeader,
  ResponsiveContainer,
  SearchInput,
} from '@healthy-aahar/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Employee directory (Phase 05, Stage B redesign). "Employee" in the
 * product sense is `AdminUser` in the data model — the invite/role/
 * deactivate machinery already existed from Phase 03/04's RBAC work; this
 * page's visual redesign changes presentation only, not the API calls,
 * debounce timing or error handling below.
 */
export default function EmployeesPage() {
  const router = useRouter();
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

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: 'name',
      header: 'Name',
      hideOnMobile: true,
      render: (employee) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sand-900 font-semibold">{employee.full_name}</span>
            {employee.is_super_admin ? <Badge tone="success">Super Admin</Badge> : null}
            {employee.deactivated ? <Badge tone="danger">Deactivated</Badge> : null}
          </div>
          <p className="text-caption text-sand-600 mt-0.5">
            {employee.email ?? 'No email on file'}
            {employee.designation ? ` · ${employee.designation}` : ''}
            {employee.department ? ` · ${employee.department}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (employee) => (
        <div className="flex flex-wrap justify-end gap-1 sm:justify-start">
          {employee.roles.length > 0 ? (
            employee.roles.map((role) => (
              <Badge key={role} tone="neutral">
                {role}
              </Badge>
            ))
          ) : (
            <span className="text-sand-400">—</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Employees"
          description="Invite staff and manage role-based access."
          action={
            <Link href="/employees/new">
              <Button>Invite employee</Button>
            </Link>
          }
        />

        <div className="mt-5 max-w-xs">
          <SearchInput
            placeholder="Search by name or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            label="Search employees"
          />
        </div>

        <div className="mt-6">
          <DataTable
            columns={columns}
            data={employees}
            rowKey={(employee) => employee.id}
            error={error}
            onRetry={() => void load(q)}
            emptyTitle="No employees found"
            emptyDescription={q ? 'Try a different search.' : 'Invite your first team member.'}
            onRowClick={(employee) => router.push(`/employees/${employee.id}`)}
          />
        </div>
      </ResponsiveContainer>
    </main>
  );
}
