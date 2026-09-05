'use client';

// Minimal loader + opener for Razorpay Checkout. Loads the script once and
// exposes a helper to open the popup for a given order.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay?: any;
  }
}

let scriptPromise: Promise<boolean> | null = null;

export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export interface CheckoutParams {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  merchantName: string;
  internalOrderId: string;
}

export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function openRazorpayCheckout(
  params: CheckoutParams,
  onSuccess: (resp: CheckoutSuccess) => void,
  onDismiss: () => void
): Promise<void> {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    onDismiss();
    return;
  }

  const rzp = new window.Razorpay({
    key: params.keyId,
    order_id: params.razorpayOrderId,
    amount: params.amountPaise,
    currency: 'INR',
    name: params.merchantName,
    description: `Order ${params.internalOrderId}`,
    prefill: {
      name: 'Test Buyer',
      email: 'buyer@example.com',
      contact: '9999999999',
    },
    theme: { color: '#2B6CB0' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (resp: any) => {
      onSuccess({
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature,
      });
    },
    modal: {
      ondismiss: () => onDismiss(),
    },
  });

  rzp.open();
}
