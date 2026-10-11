import type { Metadata } from 'next';

import { Container } from '@/components/container';
import { FaqAccordion } from '@/components/faq-accordion';
import { FAQS } from '@/lib/faq-data';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Frequently asked questions',
  description: 'Delivery areas, slots, payment and more — answers to common Healthy Aahar questions.',
};

export default function FaqPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  return (
    <Container className="max-w-2xl py-14 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <p className="text-caption text-center font-semibold tracking-wide text-green-600 uppercase">
        FAQ
      </p>
      <h1 className="font-display text-display-sm text-sand-900 mt-2 text-center">
        Frequently asked questions
      </h1>
      <div className="mt-10">
        <FaqAccordion />
      </div>
    </Container>
  );
}
