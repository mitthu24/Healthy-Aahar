import type { SVGProps } from 'react';

/**
 * A small inline icon set for the nav — deliberately not a new dependency.
 * Every icon is a plain 20x20 stroke glyph sharing one visual language, so
 * adding a nav item never means reaching for a mismatched icon pack.
 */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="11" y="2.5" width="6.5" height="4" rx="1.5" />
      <rect x="11" y="8.5" width="6.5" height="9" rx="1.5" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5" />
    </Icon>
  );
}

export function OrdersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 3h12l-1 12.5a2 2 0 0 1-2 1.5H7a2 2 0 0 1-2-1.5L4 3Z" />
      <path d="M7 3V2.5A3 3 0 0 1 10 0a3 3 0 0 1 3 2.5V3" />
      <path d="M7 8h6M7 11.5h4" />
    </Icon>
  );
}

export function DeliveryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="9" height="7" rx="1" />
      <path d="M11 9h3.5L17 11.5V13h-6V9Z" />
      <circle cx="6" cy="15.5" r="1.7" />
      <circle cx="14" cy="15.5" r="1.7" />
    </Icon>
  );
}

export function SlotsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </Icon>
  );
}

export function ProductsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" />
      <path d="M3 6.5V14l7 3.5V10M17 6.5V14l-7 3.5" />
    </Icon>
  );
}

export function CategoriesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
    </Icon>
  );
}

export function EmployeesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="7.5" cy="6" r="3" />
      <path d="M2 17v-1.5A4 4 0 0 1 6 11.5h3a4 4 0 0 1 4 4V17" />
      <circle cx="14.5" cy="6.5" r="2.2" />
      <path d="M13 11.7a4 4 0 0 1 4.5 3.8V17" />
    </Icon>
  );
}

export function RolesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 2.5 4 5v5c0 4 2.6 6.8 6 8 3.4-1.2 6-4 6-8V5l-6-2.5Z" />
      <path d="m7.3 10 1.9 1.9 3.5-3.6" />
    </Icon>
  );
}

export function AuditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 2.5h7l3 3V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3M7 10h6M7 13h6" />
    </Icon>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </Icon>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </Icon>
  );
}

export function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
    </Icon>
  );
}
