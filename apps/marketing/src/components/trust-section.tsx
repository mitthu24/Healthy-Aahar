import Image from 'next/image';

import { Container } from './container';
import { CheckCircleIcon } from './icons';

const POINTS = [
  'Prepared the same morning we deliver it',
  'No preservatives, no cold storage ageing',
  'Delivery slots you choose and we track',
  'Serviceability checked for your exact pincode',
] as const;

export function TrustSection() {
  return (
    <section className="py-16 sm:py-20">
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="relative order-2 aspect-[4/3] w-full overflow-hidden rounded-2xl lg:order-1">
          <Image
            src="https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=1000&q=80"
            alt="Fresh vegetables and grains being prepared on a kitchen counter"
            fill
            loading="lazy"
            sizes="(max-width: 1024px) 90vw, 520px"
            className="object-cover"
          />
        </div>

        <div className="order-1 lg:order-2">
          <p className="text-caption font-semibold tracking-wide text-green-600 uppercase">
            Freshness &amp; trust
          </p>
          <h2 className="font-display text-heading-lg sm:text-display-sm text-sand-900 mt-2 text-balance">
            We only promise what we actually do
          </h2>
          <p className="text-body-md text-sand-600 mt-4 max-w-md">
            No fabricated certifications, no invented ratings &mdash; just how our kitchen and
            delivery actually work.
          </p>

          <ul className="mt-7 space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <span className="text-body-md text-sand-800">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
