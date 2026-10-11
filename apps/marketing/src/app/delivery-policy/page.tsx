import type { Metadata } from 'next';

import { LegalNotice, LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Shipping & Delivery Policy' };

export default function DeliveryPolicyPage() {
  return (
    <LegalPage title="Shipping & Delivery Policy" updated="11 October 2026">
      <h2>Delivery area</h2>
      <p>
        We currently deliver only within serviceable pincodes in Noida, Uttar Pradesh. You can
        check your exact pincode on our homepage &mdash; this is computed live from our
        delivery-area data, not a fixed list on this page.
      </p>

      <h2>Delivery slots</h2>
      <p>
        Orders are delivered in morning or evening slots. Exact slot timings are shown at
        checkout, since they can vary by area.
      </p>

      <h2>Delivery charges</h2>
      <p>
        Any delivery fee or minimum order value is shown at checkout before you confirm an
        order, calculated from current settings rather than fixed on this page.
      </p>

      <h2>Missed deliveries</h2>
      <p>
        If you&rsquo;re unavailable to receive an order in your chosen slot, contact support as
        soon as possible so we can help.
      </p>

      <LegalNotice>
        We&rsquo;re actively expanding coverage within Noida. If your pincode isn&rsquo;t
        serviceable yet, the pincode checker will say so rather than guess.
      </LegalNotice>
    </LegalPage>
  );
}
