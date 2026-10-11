import type { BadgeTone } from '@healthy-aahar/ui';

export function adminStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'DELIVERED':
    case 'CONFIRMED':
      return 'success';
    case 'CANCELLED':
    case 'FAILED':
    case 'RETURNED':
      return 'danger';
    case 'OUT_FOR_DELIVERY':
      return 'info';
    default:
      return 'warning';
  }
}

/** Next forward-fulfilment status this console offers a one-click action for, if any. */
export function nextFulfilmentStatus(status: string): { to: string; label: string } | null {
  switch (status) {
    case 'CONFIRMED':
      return { to: 'PREPARING', label: 'Start preparing' };
    case 'PREPARING':
      return { to: 'READY_FOR_DISPATCH', label: 'Mark ready for dispatch' };
    case 'READY_FOR_DISPATCH':
      return { to: 'OUT_FOR_DELIVERY', label: 'Dispatch' };
    case 'OUT_FOR_DELIVERY':
      return { to: 'DELIVERED', label: 'Mark delivered' };
    case 'FAILED':
      return { to: 'OUT_FOR_DELIVERY', label: 'Retry delivery' };
    default:
      return null;
  }
}

export function canReject(status: string): boolean {
  return status === 'CONFIRMED' || status === 'PREPARING' || status === 'READY_FOR_DISPATCH';
}

export function canHold(status: string): boolean {
  return !['DELIVERED', 'CANCELLED', 'FAILED', 'RETURNED'].includes(status);
}

export function canRecordCodCollection(status: string): boolean {
  return status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED';
}

/** `OUT_FOR_DELIVERY -> FAILED` is a reasoned exception, not the forward happy path. */
export function canMarkDeliveryFailed(status: string): boolean {
  return status === 'OUT_FOR_DELIVERY';
}
