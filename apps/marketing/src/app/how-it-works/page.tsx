import type { Metadata } from 'next';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';
import { Container } from '@/components/container';
import { HowItWorks } from '@/components/how-it-works';
import { PincodeChecker } from '@/components/pincode-checker';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'How ordering, preparation and delivery work at Healthy Aahar, in Noida.',
};

export default function HowItWorksPage() {
  return (
    <>
      <Container className="py-14 text-center sm:py-20">
        <p className="text-caption font-semibold tracking-wide text-green-600 uppercase">
          How it works
        </p>
        <h1 className="font-display text-display-sm text-sand-900 mx-auto mt-2 max-w-2xl text-balance">
          Order, prepare, deliver &mdash; the same day
        </h1>
        <p className="text-body-md text-sand-600 mx-auto mt-4 max-w-xl">
          No stock sitting in cold storage. Every order starts a fresh prep, timed to your
          delivery slot.
        </p>
        <div className="mx-auto mt-8 max-w-md">
          <PincodeChecker />
        </div>
      </Container>

      <HowItWorks />

      <Container className="py-16 text-center sm:py-20">
        <h2 className="font-display text-heading-lg text-sand-900">Ready to try it?</h2>
        <div className="mt-6">
          <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
            <Button size="lg">Shop today&rsquo;s menu</Button>
          </a>
        </div>
      </Container>
    </>
  );
}
