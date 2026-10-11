/** Mirrors the customer-visible statuses from which the API allows a customer-initiated cancel. */
export function canCancelDisplayStatus(displayStatus: string): boolean {
  return displayStatus === 'Awaiting confirmation' || displayStatus === 'Confirmed';
}
