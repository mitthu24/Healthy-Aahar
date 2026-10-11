import Link from 'next/link';

import { Button } from '@healthy-aahar/ui';

import { Container } from './container';
import { CalendarClockIcon, LeafIcon, SproutIcon } from './icons';

const POINTS = [
  { icon: CalendarClockIcon, text: 'Pick a daily or alternate-day routine' },
  { icon: LeafIcon, text: 'Fresh prep, every single delivery' },
  { icon: SproutIcon, text: 'One less thing to plan each morning' },
] as const;

/**
 * Honest, pre-launch framing — subscriptions are not yet self-serve in the
 * customer app (no /subscriptions route exists there today), so this is a
 * proposition page, not a working checkout. No CTA claims a feature that
 * does not exist yet.
 */
export function SubscriptionTeaser() {
  return (
    <section className="bg-green-800 py-16 text-sand-0 sm:py-20">
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-caption font-semibold tracking-wide text-green-200 uppercase">
            Coming to your routine
          </p>
          <h2 className="font-display text-heading-lg sm:text-display-sm mt-2 text-balance">
            Healthy eating, on repeat
          </h2>
          <p className="text-body-md mt-4 max-w-md text-green-100">
            We&rsquo;re building subscriptions so your healthy routine doesn&rsquo;t need
            re-ordering every day. Here&rsquo;s what it&rsquo;s designed around.
          </p>
          <div className="mt-7">
            <Link href="/subscriptions">
              <Button variant="secondary" size="lg">
                See the plan
              </Button>
            </Link>
          </div>
        </div>

        <ul className="grid gap-4 sm:grid-cols-1">
          {POINTS.map((point) => (
            <li
              key={point.text}
              className="flex items-center gap-4 rounded-xl bg-green-700/60 p-4"
            >
              <point.icon className="h-6 w-6 shrink-0 text-green-100" />
              <span className="text-body-md">{point.text}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
