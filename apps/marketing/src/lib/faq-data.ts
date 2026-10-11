/** Shared FAQ content — the homepage preview, /faq, and the FAQPage structured
 *  data all read from this single list so copy and schema never drift apart. */
export const FAQS = [
  {
    question: 'Where do you currently deliver?',
    answer:
      'We deliver across serviceable pincodes in Noida, Uttar Pradesh. Enter your pincode on the homepage to check your exact address.',
  },
  {
    question: 'What delivery slots are available?',
    answer:
      'Morning and evening delivery slots. Available slots and their exact timing are shown when you check out, since they can change by area and demand.',
  },
  {
    question: 'How is the food prepared?',
    answer:
      'Fruit is cut, salads assembled and meals cooked the same day they’re delivered — nothing is held in cold storage ahead of time.',
  },
  {
    question: 'How do I pay?',
    answer: 'Orders are currently placed and paid for at the time of delivery.',
  },
  {
    question: 'Can I subscribe for regular delivery?',
    answer:
      'Subscriptions are in development. You can place individual orders today, and we’ll announce subscription sign-up here once it’s live.',
  },
  {
    question: 'What if my pincode isn’t serviceable yet?',
    answer:
      'We’re expanding coverage within Noida. Check back, or reach out to support@healthyaahar.com and we’ll let you know when we reach your area.',
  },
] as const;
