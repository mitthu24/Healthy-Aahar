import type { Metadata } from 'next';

import { LegalNotice, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="11 October 2026">
      <h2>What we collect</h2>
      <p>
        To create an account and deliver an order, we collect your name, phone number, email,
        delivery address and order history. We don&rsquo;t collect payment card details ourselves
        &mdash; orders are currently paid for at the time of delivery.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To process and deliver your orders to the correct address and slot.</li>
        <li>To contact you about an order, a delivery issue, or account security.</li>
        <li>To check whether your pincode is serviceable.</li>
      </ul>

      <h2>What we don&rsquo;t do</h2>
      <p>
        We don&rsquo;t sell your personal information. We don&rsquo;t show advertising based on your
        order history.
      </p>

      <h2>Your account</h2>
      <p>
        Your password is stored as an irreversible cryptographic hash, never in plain text. You can
        sign out of your session at any time from the app.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about your data can be sent to{' '}
        <a
          href="mailto:support@healthyaahar.com"
          className="font-semibold text-green-700 hover:underline"
        >
          support@healthyaahar.com
        </a>
        .
      </p>

      <LegalNotice>
        Formal data-protection registration details (where applicable) will be added here once
        finalised. Until then, treat this page as our current, genuine practice, not a compliance
        certification.
      </LegalNotice>
    </LegalPage>
  );
}
