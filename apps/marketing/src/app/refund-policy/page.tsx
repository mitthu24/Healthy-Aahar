import type { Metadata } from 'next';

import { LegalNotice, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Refund & Cancellation Policy' };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy" updated="11 October 2026">
      <h2>Why this policy is simple</h2>
      <p>
        We prepare fresh food the same day it&rsquo;s delivered, so our policy is built around
        that: cancellation works before we start preparing your order, and issues after delivery
        are handled case by case through support.
      </p>

      <h2>Cancelling an order</h2>
      <p>
        You can cancel an order from the app before it enters preparation for your delivery
        slot. Once preparation has started, the order can no longer be cancelled, because the
        food has already been made.
      </p>

      <h2>If something&rsquo;s wrong with your order</h2>
      <p>
        If an item arrives damaged, incorrect, or not as described, contact support within a
        reasonable time of delivery with your order number. We review these individually &mdash;
        we don&rsquo;t promise an automatic refund outcome here, because it depends on the
        specifics.
      </p>

      <h2>How to reach us</h2>
      <p>
        Email{' '}
        <a href="mailto:support@healthyaahar.com" className="font-semibold text-green-700 hover:underline">
          support@healthyaahar.com
        </a>{' '}
        or call{' '}
        <a href="tel:+911204000000" className="font-semibold text-green-700 hover:underline">
          +91 120 400 0000
        </a>
        .
      </p>

      <LegalNotice>
        We don&rsquo;t currently offer automated recurring-payment refunds, since subscriptions
        aren&rsquo;t live yet. This page will be updated when that changes.
      </LegalNotice>
    </LegalPage>
  );
}
