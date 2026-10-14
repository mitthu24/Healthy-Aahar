'use client';

import { ApiError, type Permission, type Role } from '@healthy-aahar/sdk';
import { Badge, Button, Card, FieldError, FieldLabel, Input, Skeleton } from '@healthy-aahar/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

function groupByResource(permissions: Permission[]): Map<string, Permission[]> {
  const groups = new Map<string, Permission[]>();
  for (const perm of permissions) {
    const list = groups.get(perm.resource) ?? [];
    list.push(perm);
    groups.set(perm.resource, list);
  }
  return groups;
}

function PermissionGrid({
  permissions,
  selected,
  onToggle,
  disabled,
}: {
  permissions: Permission[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  const grouped = useMemo(() => groupByResource(permissions), [permissions]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[...grouped.entries()].map(([resource, perms]) => (
        <div key={resource}>
          <p className="text-caption text-sand-500 font-semibold uppercase tracking-wide">
            {resource}
          </p>
          <div className="mt-2 space-y-1.5">
            {perms.map((perm) => (
              <label key={perm.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  disabled={disabled}
                  checked={selected.has(perm.key)}
                  onChange={() => onToggle(perm.key)}
                />
                <span className="text-body-sm text-sand-800">
                  {perm.key}
                  <span className="text-caption text-sand-500 block">{perm.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleCard({
  role,
  permissions,
  onChanged,
}: {
  role: Role;
  permissions: Permission[];
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(new Set(role.permissions));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.updateRolePermissions(role.id, [...selected]);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save permissions.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-body-sm text-sand-900 font-semibold">{role.name}</p>
            {role.is_system ? <Badge tone="neutral">Built-in</Badge> : null}
          </div>
          {role.description ? (
            <p className="text-caption text-sand-600 mt-0.5">{role.description}</p>
          ) : null}
          <p className="text-caption text-sand-500 mt-1">
            {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Hide' : 'Edit permissions'}
        </Button>
      </div>

      {expanded ? (
        <div className="border-sand-100 mt-4 border-t pt-4">
          <PermissionGrid permissions={permissions} selected={selected} onToggle={toggle} />
          <FieldError>{error}</FieldError>
          <Button size="sm" className="mt-4" isLoading={isSubmitting} onClick={() => void save()}>
            Save permissions
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function CreateRoleForm({
  permissions,
  onCreated,
}: {
  permissions: Permission[];
  onCreated: () => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createRole({
        key,
        name,
        description: description || undefined,
        permission_keys: [...selected],
      });
      setKey('');
      setName('');
      setDescription('');
      setSelected(new Set());
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this role.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="role-key">Key (UPPER_SNAKE_CASE)</FieldLabel>
          <Input
            id="role-key"
            required
            placeholder="INVENTORY_LEAD"
            className="mt-1"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <FieldLabel htmlFor="role-name">Display name</FieldLabel>
          <Input
            id="role-name"
            required
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="role-description">Description (optional)</FieldLabel>
        <Input
          id="role-description"
          className="mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <p className="text-body-sm text-sand-700 font-medium">Permissions</p>
        <div className="mt-2">
          <PermissionGrid permissions={permissions} selected={selected} onToggle={toggle} />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" isLoading={isSubmitting}>
        Create role
      </Button>
    </form>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setError(null);
    try {
      const [roleList, permList] = await Promise.all([
        apiClient.listRoles(),
        apiClient.listPermissions(),
      ]);
      setRoles(roleList.data);
      setPermissions(permList.data);
    } catch {
      setError('Could not load roles.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 pb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-heading-lg text-sand-900">Roles &amp; permissions</h1>
        {!showCreate ? (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            New custom role
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-body-sm text-danger-600 mt-4">{error}</p> : null}

      {showCreate && permissions ? (
        <Card className="mt-5 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading-sm text-sand-900">New custom role</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
          <div className="mt-4">
            <CreateRoleForm
              permissions={permissions}
              onCreated={() => {
                setShowCreate(false);
                void load();
              }}
            />
          </div>
        </Card>
      ) : null}

      <div className="mt-6 space-y-3">
        {roles === null || permissions === null
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          : roles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                permissions={permissions}
                onChanged={() => void load()}
              />
            ))}
      </div>
    </main>
  );
}
