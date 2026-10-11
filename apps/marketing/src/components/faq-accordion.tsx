import { FAQS } from '@/lib/faq-data';

import { ChevronDownIcon } from './icons';

/**
 * Native <details>/<summary> — fully keyboard- and screen-reader-accessible
 * with zero client JS, and the open/closed state is exactly what assistive
 * tech expects from a disclosure widget.
 */
export function FaqAccordion({ limit }: { limit?: number }) {
  const items = limit ? FAQS.slice(0, limit) : FAQS;

  return (
    <div className="divide-sand-200 border-sand-200 divide-y rounded-xl border">
      {items.map((item) => (
        <details key={item.question} className="open:bg-sand-50 group p-5">
          <summary className="text-body-md text-sand-900 flex cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 [&::-webkit-details-marker]:hidden">
            {item.question}
            <ChevronDownIcon className="text-sand-400 h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="text-body-sm text-sand-600 mt-3">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
