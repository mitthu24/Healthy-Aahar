/**
 * In-process effective-permissions cache (docs/08 §5.2).
 *
 * Keyed by `admin_user_id`, 60-second TTL. A write to `admin_user_roles` or
 * `role_permissions` bumps a global version counter, which invalidates every
 * cached entry immediately — a revoked permission never lingers past the
 * write that revoked it, regardless of TTL.
 */
export type EffectivePermissions = {
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
};

export class PermissionCache {
  private version = 0;
  private readonly entries = new Map<string, { at: number; version: number; value: EffectivePermissions }>();

  constructor(private readonly ttlMs = 60_000) {}

  get(adminUserId: string): EffectivePermissions | undefined {
    const entry = this.entries.get(adminUserId);
    if (!entry) return undefined;
    if (entry.version !== this.version) return undefined;
    if (Date.now() - entry.at > this.ttlMs) return undefined;
    return entry.value;
  }

  set(adminUserId: string, value: EffectivePermissions): void {
    this.entries.set(adminUserId, { at: Date.now(), version: this.version, value });
  }

  /** Call after any change to admin_user_roles or role_permissions. */
  invalidateAll(): void {
    this.version += 1;
  }

  /** Narrower invalidation for a single admin — used after their own role change. */
  invalidate(adminUserId: string): void {
    this.entries.delete(adminUserId);
  }
}
