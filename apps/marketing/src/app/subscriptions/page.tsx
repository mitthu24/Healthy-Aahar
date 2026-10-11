import type { Metadata } from 'next';
import Image from 'next/image';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';
import { Container } from '@/components/container';
import { CalendarClockIcon, LeafIcon, ShieldCheckIcon, SproutIcon } from '@/components/icons';
import { SectionHeading } from '@/components/section-heading';

export const metadata: Metadata = {
  title: 'Subscriptions',
  description: 'Healthy Aahar is building a subscription for recurring fresh-food delivery.',
};

const BENEFITS = [
  {
    icon: CalendarClockIcon,
    title: 'A routine, not a re-order',
    description: 'Set up a daily or alternate-day delivery instead of ordering from scratch each time.',
  },
  {
    icon: LeafIcon,
    title: 'Still prepared fresh',
    description: 'Every subscription delivery is made the same way as a one-time order — the same day, not in advance.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Built around control',
    description: 'A subscription should be easy to pause, change or cancel — we’re building it that way from the start.',
  },
] as const;

export default function SubscriptionsPage() {
  return (
    <>
      <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-caption inline-flex items-center rounded-full bg-citrus-100 px-3 py-1 font-semibold tracking-wide text-citrus-700 uppercase">
            In development
          </p>
          <h1 className="font-display text-display-sm text-sand-900 mt-5 text-balance">
            A healthy routine, without re-ordering every day
          </h1>
          <p className="text-body-lg text-sand-600 mt-4 max-w-md">
            We&rsquo;re building subscriptions so fresh, healthy food shows up on a schedule you
            set — without placing a new order each time. It isn&rsquo;t open for sign-up yet,
            but here&rsquo;s what it&rsquo;s designed around.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
              <Button size="lg">Order today instead</Button>
            </a>
          </div>
        </div>

        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl shadow-xl">
          <Image
            src="https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1000&q=80"
            alt="A weekly rhythm of fresh produce and healthy meals laid out for the morning"
            fill
            sizes="(max-width: 1024px) 90vw, 520px"
            className="object-cover"
          />
        </div>
      </Container>

      <section className="bg-sand-0 py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="What we're building"
            title="Designed around a real daily routine"
            align="center"
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="border-sand-200 rounded-xl border p-6 text-center">
                <benefit.icon className="mx-auto h-8 w-8 text-green-600" />
                <h3 className="text-heading-sm text-sand-900 mt-4">{benefit.title}</h3>
                <p className="text-body-sm text-sand-600 mt-2">{benefit.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <Container className="py-16 text-center sm:py-20">
        <SproutIcon className="mx-auto h-10 w-10 text-green-600" />
        <h2 className="font-display text-heading-lg text-sand-900 mt-4">
          Want to know when it launches?
        </h2>
        <p className="text-body-md text-sand-600 mx-auto mt-2 max-w-md">
          Place an order today and we&rsquo;ll have your details ready the moment subscriptions
          open, or email us directly.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
            <Button size="lg">Shop today&rsquo;s menu</Button>
          </a>
          <a href="mailto:support@healthyaahar.com">
            <Button size="lg" variant="secondary">
              Email us
            </Button>
          </a>
        </div>
      </Container>
    </>
  );
}
