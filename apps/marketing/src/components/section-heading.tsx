import { cn } from '@healthy-aahar/ui';

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow ? (
        <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-display text-heading-lg sm:text-display-sm text-sand-900 mt-2 text-balance">
        {title}
      </h2>
      {description ? <p className="text-body-md text-sand-600 mt-3">{description}</p> : null}
    </div>
  );
}
