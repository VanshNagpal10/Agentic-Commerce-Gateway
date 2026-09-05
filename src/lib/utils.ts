import { v4 as uuidv4 } from 'uuid';

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

export function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(rupees);
}

export function generateTraceId(): string {
  return `trace_${uuidv4()}`;
}

export function generateIdempotencyKey(...parts: string[]): string {
  // simple deterministic hash for demonstration
  return parts.join('_');
}

/**
 * Deterministic idempotency key for a cart. Same merchant + same items
 * (regardless of order) + same trace produces the same key, so re-quoting
 * an identical cart in the same session returns the existing order.
 */
export function computeCartIdempotencyKey(
  merchantId: string,
  items: Array<{ productId: string; quantity: number }>,
  scope: string
): string {
  const normalized = [...items]
    .map((i) => `${i.productId}:${i.quantity}`)
    .sort()
    .join(',');
  return `${merchantId}|${scope}|${normalized}`;
}

export function paise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function rupees(paise: number): number {
  return paise / 100;
}

/**
 * URL-safe slug: lowercase, trim, non-alphanumerics collapsed to single hyphens.
 * Used for readable merchant ids (e.g. "Urban Thread!" → "urban-thread").
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

