import type { Metadata } from 'next';

import { LegalNotice, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Terms & Conditions' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms & Conditions" updated="11 October 2026">
      <h2>Using Healthy Aahar</h2>
      <p>
        These terms apply when you browse healthyaahar.com or order through the Healthy Aahar
        customer app. By placing an order, you agree to the terms on this page.
      </p>

      <h2>Orders and availability</h2>
      <p>
        Products shown are limited to what our kitchen has prepared for the day. Availability,
        pricing and delivery slots are confirmed at the time you place an order, not on this
        marketing site, which refreshes periodically from the same source.
      </p>

      <h2>Delivery area</h2>
      <p>
        We currently deliver to serviceable pincodes within Noida, Uttar Pradesh. You can check
        whether your address is covered on our homepage before ordering.
      </p>

      <h2>Payment</h2>
      <p>Orders are currently placed and paid for at the time of delivery.</p>

      <h2>Account responsibility</h2>
      <p>
        You&rsquo;re responsible for the accuracy of the delivery address and contact details you
        provide, and for keeping your account credentials to yourself.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the service evolves. The date above reflects the latest
        version.
      </p>

      <LegalNotice>
        We&rsquo;re a growing local food business. Specific legal-entity details (registered company
        name and registration number) will be published here once finalised.
      </LegalNotice>
    </LegalPage>
  );
}
