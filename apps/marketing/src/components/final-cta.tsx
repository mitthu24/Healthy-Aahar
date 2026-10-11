import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';

import { Container } from './container';
import { PincodeChecker } from './pincode-checker';

export function FinalCta() {
  return (
    <section className="bg-sand-50 py-16 sm:py-20">
      <Container className="text-center">
        <h2 className="font-display text-heading-lg sm:text-display-sm text-sand-900 mx-auto max-w-xl text-balance">
          Fresh, healthy food &mdash; ready when you are
        </h2>
        <p className="text-body-md text-sand-600 mx-auto mt-3 max-w-md">
          Check your pincode, browse today&rsquo;s menu, and get it delivered in a slot that works
          for you.
        </p>

        <div className="mx-auto mt-7 max-w-md">
          <PincodeChecker className="text-left" />
        </div>

        <div className="mt-6">
          <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
            <Button size="lg">Shop today&rsquo;s menu</Button>
          </a>
        </div>
      </Container>
    </section>
  );
}
