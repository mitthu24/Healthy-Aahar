import { AuthGate } from '@/components/auth-gate';
import { BottomNav } from '@/components/bottom-nav';

/** Every route under this group requires a session with `deliveries:fulfil`. `/login` is deliberately outside it. */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="pb-16">{children}</div>
      <BottomNav />
    </AuthGate>
  );
}
