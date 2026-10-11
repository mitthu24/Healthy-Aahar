import { CategoryRail } from '@/components/category-rail';
import { FaqSection } from '@/components/faq-section';
import { FeaturedProducts } from '@/components/featured-products';
import { FinalCta } from '@/components/final-cta';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { SubscriptionTeaser } from '@/components/subscription-teaser';
import { TrustSection } from '@/components/trust-section';
import { WhyHealthyAahar } from '@/components/why-healthy-aahar';
import { FAQS } from '@/lib/faq-data';
import { env } from '@/lib/env';

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Healthy Aahar',
  url: env.NEXT_PUBLIC_MARKETING_URL,
  email: 'support@healthyaahar.com',
  telephone: '+911204000000',
  areaServed: { '@type': 'City', name: 'Noida' },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Noida',
    addressRegion: 'UP',
    addressCountry: 'IN',
  },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.slice(0, 5).map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <Hero />
      <CategoryRail />
      <HowItWorks />
      <WhyHealthyAahar />
      <FeaturedProducts />
      <SubscriptionTeaser />
      <TrustSection />
      <FaqSection />
      <FinalCta />
    </>
  );
}
