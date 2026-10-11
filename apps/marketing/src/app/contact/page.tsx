import type { Metadata } from 'next';

import { Container } from '@/components/container';
import { FaqAccordion } from '@/components/faq-accordion';
import { MailIcon, PhoneIcon } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Contact & support',
  description: 'Get in touch with Healthy Aahar support by phone or email.',
};

export default function ContactPage() {
  return (
    <Container className="py-14 sm:py-20">
      <div className="max-w-xl">
        <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
          Contact &amp; support
        </p>
        <h1 className="font-display text-display-sm text-sand-900 mt-2 text-balance">
          We&rsquo;re happy to help
        </h1>
        <p className="text-body-md text-sand-600 mt-4">
          For order questions, delivery issues or anything else, reach us directly &mdash; we
          don&rsquo;t yet have an online contact form wired up, so phone and email are the fastest
          way to reach a real person.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:max-w-xl sm:grid-cols-2">
        <a
          href="tel:+911204000000"
          className="border-sand-200 flex items-center gap-4 rounded-xl border p-5 hover:border-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <PhoneIcon className="h-5 w-5" />
          </span>
          <span>
            <span className="text-body-sm text-sand-600 block">Call us</span>
            <span className="text-body-md text-sand-900 font-semibold">+91 120 400 0000</span>
          </span>
        </a>

        <a
          href="mailto:support@healthyaahar.com"
          className="border-sand-200 flex items-center gap-4 rounded-xl border p-5 hover:border-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <MailIcon className="h-5 w-5" />
          </span>
          <span>
            <span className="text-body-sm text-sand-600 block">Email us</span>
            <span className="text-body-md text-sand-900 font-semibold">
              support@healthyaahar.com
            </span>
          </span>
        </a>
      </div>

      <div className="mt-16 max-w-2xl">
        <h2 className="text-heading-md text-sand-900">Common questions</h2>
        <div className="mt-6">
          <FaqAccordion />
        </div>
      </div>
    </Container>
  );
}
