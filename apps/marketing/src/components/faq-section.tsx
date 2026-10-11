import Link from 'next/link';

import { Container } from './container';
import { FaqAccordion } from './faq-accordion';
import { SectionHeading } from './section-heading';

export function FaqSection() {
  return (
    <section className="bg-sand-0 py-16 sm:py-20">
      <Container className="max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" align="center" />
        <div className="mt-10">
          <FaqAccordion limit={5} />
        </div>
        <p className="text-body-sm text-sand-600 mt-6 text-center">
          <Link href="/faq" className="font-semibold text-green-700 hover:underline">
            See all questions &rarr;
          </Link>
        </p>
      </Container>
    </section>
  );
}
