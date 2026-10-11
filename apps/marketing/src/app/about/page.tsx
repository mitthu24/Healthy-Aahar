import type { Metadata } from 'next';
import Image from 'next/image';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';
import { Container } from '@/components/container';
import { LeafIcon, ShieldCheckIcon, SproutIcon } from '@/components/icons';

export const metadata: Metadata = {
  title: 'About us',
  description: 'Why Healthy Aahar exists, and how we think about fresh food in Noida.',
};

const VALUES = [
  {
    icon: SproutIcon,
    title: 'Fresh is a process, not a label',
    description: 'We prepare the same day we deliver, instead of stocking ahead and calling it fresh.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Say only what’s true',
    description: 'No invented certifications or ratings. If we haven’t verified it, we don’t claim it.',
  },
  {
    icon: LeafIcon,
    title: 'Healthy should be convenient',
    description: 'Good food shouldn’t require extra effort to find, order or receive.',
  },
] as const;

export default function AboutPage() {
  return (
    <>
      <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-caption font-semibold tracking-wide text-green-600 uppercase">
            About us
          </p>
          <h1 className="font-display text-display-sm text-sand-900 mt-2 text-balance">
            Making healthy eating the easy choice
          </h1>
          <p className="text-body-lg text-sand-600 mt-4 max-w-md">
            Healthy Aahar started with a simple frustration: eating well in a busy day
            shouldn&rsquo;t mean choosing between &ldquo;fresh&rdquo; and &ldquo;convenient.&rdquo;
            So we built a kitchen and delivery operation around doing both at once &mdash;
            starting in Noida.
          </p>
          <p className="text-body-md text-sand-600 mt-4 max-w-md">
            Every order is prepared the same day it&rsquo;s delivered. We&rsquo;d rather keep our
            claims small and true than make big ones we can&rsquo;t stand behind.
          </p>
        </div>

        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl shadow-xl">
          <Image
            src="https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=1000&q=80"
            alt="Fresh ingredients being prepared for the day's orders"
            fill
            sizes="(max-width: 1024px) 90vw, 520px"
            className="object-cover"
          />
        </div>
      </Container>

      <section className="bg-sand-0 py-16 sm:py-20">
        <Container>
          <h2 className="font-display text-heading-lg text-sand-900 text-center">
            What we actually try to do
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {VALUES.map((value) => (
              <div key={value.title} className="border-sand-200 rounded-xl border p-6">
                <value.icon className="h-8 w-8 text-green-600" />
                <h3 className="text-heading-sm text-sand-900 mt-4">{value.title}</h3>
                <p className="text-body-sm text-sand-600 mt-2">{value.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <Container className="py-16 text-center sm:py-20">
        <h2 className="font-display text-heading-lg text-sand-900">
          Currently delivering in Noida
        </h2>
        <p className="text-body-md text-sand-600 mx-auto mt-2 max-w-md">
          We&rsquo;re growing carefully, one neighbourhood at a time, rather than promising
          coverage we can&rsquo;t yet deliver on.
        </p>
        <div className="mt-6">
          <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
            <Button size="lg">Shop today&rsquo;s menu</Button>
          </a>
        </div>
      </Container>
    </>
  );
}
