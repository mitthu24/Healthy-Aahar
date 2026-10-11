import { Container } from './container';

/** Genuine, static launch information — no fabricated promo or countdown. */
export function AnnouncementBar() {
  return (
    <div className="bg-green-800 text-sand-0">
      <Container className="flex h-9 items-center justify-center">
        <p className="text-caption truncate text-center font-medium tracking-wide">
          Now delivering fresh, healthy food across Noida · Morning &amp; evening slots
        </p>
      </Container>
    </div>
  );
}
