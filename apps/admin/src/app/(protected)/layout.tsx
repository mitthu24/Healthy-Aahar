import { AuthGate } from '@/components/auth-gate';

/**
 * Every route under this group (`/`, `/orders`, `/products`, `/categories`,
 * `/delivery-slots`, `/change-password`) requires a session — enforced by
 * `AuthGate` (see its own doc comment for why this is a client boundary,
 * not middleware). `/login` and `/password-setup` are deliberately NOT in
 * this group — they are the two routes an unauthenticated visitor must be
 * able to reach.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
