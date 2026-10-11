import { Container } from './container';
import { BasketIcon, CalendarClockIcon, SproutIcon, TruckIcon } from './icons';
import { SectionHeading } from './section-heading';

const STEPS = [
  {
    icon: BasketIcon,
    title: 'Pick your food',
    description: 'Browse fresh fruit, salads, sprouts and ready meals made the same day.',
  },
  {
    icon: CalendarClockIcon,
    title: 'Choose your slot',
    description: 'Morning or evening delivery — pick the window that fits your day.',
  },
  {
    icon: SproutIcon,
    title: 'We prepare it fresh',
    description: 'Nothing is cooked or cut until your order is placed.',
  },
  {
    icon: TruckIcon,
    title: 'It arrives at your door',
    description: 'Delivered to your address, in Noida, within the slot you chose.',
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="From our kitchen to your door, the same day"
          align="center"
        />

        <ol className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative text-center sm:text-left">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-700 sm:mx-0">
                <step.icon className="h-7 w-7" />
              </div>
              <p className="text-caption text-sand-400 mt-4 font-semibold">Step {index + 1}</p>
              <h3 className="text-heading-sm text-sand-900 mt-1">{step.title}</h3>
              <p className="text-body-sm text-sand-600 mt-2">{step.description}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
