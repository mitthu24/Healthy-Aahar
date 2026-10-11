import { Container } from './container';
import { CalendarClockIcon, LeafIcon, ShieldCheckIcon, TruckIcon } from './icons';
import { SectionHeading } from './section-heading';

const REASONS = [
  {
    icon: LeafIcon,
    title: 'Prepared fresh, same day',
    description:
      'Fruit is cut, salads assembled and meals cooked the same morning they’re delivered — nothing sits in cold storage.',
  },
  {
    icon: CalendarClockIcon,
    title: 'A slot that fits your day',
    description: 'Choose a morning or evening delivery window and we show up in it.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'No preservatives',
    description: 'Food made to be eaten that day, not stocked for a shelf.',
  },
  {
    icon: TruckIcon,
    title: 'Delivered, not just listed',
    description: 'Your order comes to your address in Noida — we track every delivery slot.',
  },
] as const;

export function WhyHealthyAahar() {
  return (
    <section className="bg-sand-0 py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="Why Healthy Aahar"
          title="Healthy food, done properly"
          description="Everything about how we prepare and deliver food is built around one idea: it should taste like it was made today, because it was."
        />

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {REASONS.map((reason) => (
            <div
              key={reason.title}
              className="border-sand-200 rounded-xl border p-5 transition-shadow hover:shadow-md"
            >
              <reason.icon className="h-7 w-7 text-green-600" />
              <h3 className="text-heading-sm text-sand-900 mt-4">{reason.title}</h3>
              <p className="text-body-sm text-sand-600 mt-2">{reason.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
