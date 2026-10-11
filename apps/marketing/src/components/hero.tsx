import Image from 'next/image';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';

import { Container } from './container';
import { PincodeChecker } from './pincode-checker';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="from-sand-50 via-sand-50 absolute inset-0 -z-10 bg-gradient-to-b to-green-50" />
      <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-12 lg:py-24">
        <div>
          <p className="text-caption inline-flex items-center rounded-full bg-green-100 px-3 py-1 font-semibold tracking-wide text-green-700 uppercase">
            Fresh · Noida
          </p>

          <h1 className="font-display text-display-sm sm:text-display-lg text-sand-900 mt-5 text-balance">
            Real food, prepared this morning, at your door.
          </h1>

          <p className="text-body-lg text-sand-600 mt-5 max-w-md">
            Fresh fruit, salads, sprouts and wholesome meals — made the same day and delivered in
            a slot you choose. No preservatives, no guesswork.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
              <Button size="lg">Shop today&rsquo;s menu</Button>
            </a>
            <a href="#how-it-works">
              <Button size="lg" variant="secondary">
                See how it works
              </Button>
            </a>
          </div>

          <PincodeChecker
            id="check-delivery"
            className="border-sand-200 bg-sand-0/80 mt-8 max-w-md rounded-xl border p-4 shadow-sm backdrop-blur-sm"
          />
        </div>

        <div className="relative mx-auto aspect-[4/5] w-full max-w-md lg:max-w-none">
          <div className="absolute inset-0 overflow-hidden rounded-3xl shadow-xl">
            <Image
              src="https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1000&q=80"
              alt="Fresh seasonal fruit and vegetables arranged on a warm wooden surface"
              fill
              priority
              sizes="(max-width: 1024px) 90vw, 560px"
              className="object-cover"
            />
          </div>
          <div className="bg-sand-0 border-sand-200 absolute -bottom-5 -left-5 hidden rounded-2xl border p-4 shadow-lg sm:block">
            <p className="text-heading-sm text-green-700 font-display">Same-day prep</p>
            <p className="text-caption text-sand-600 mt-0.5">No cold storage, no preservatives</p>
          </div>
        </div>
      </Container>
    </section>
  );
}
