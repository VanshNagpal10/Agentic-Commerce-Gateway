import Razorpay from 'razorpay'
import crypto from 'crypto'

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay keys not configured. Payment features will not work.')
}

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
})

export function razorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export function verifyPaymentSignature({
  orderId,
  paymentId,
  signature,
}: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const body = orderId + '|' + paymentId
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(body)
    .digest('hex')
  return expectedSignature === signature
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected === signature
}

export type RazorpaySettlementState = 'PAID' | 'FAILED' | 'UNKNOWN'

/**
 * Fetch the real settlement state of a Razorpay order from their API.
 * Used by the status-fetch / recovery path — never creates a new order or charge.
 * Maps Razorpay payment/order status to our coarse state machine buckets.
 */
export async function fetchRazorpayOrderState(razorpayOrderId: string): Promise<{
  state: RazorpaySettlementState
  razorpayPaymentId?: string
  detail: string
}> {
  try {
    // Payments made against this order tell us the real story.
    const paymentsResp = await razorpay.orders.fetchPayments(razorpayOrderId)
    const payments = paymentsResp.items || []

    const captured = payments.find((p) => p.status === 'captured')
    if (captured) {
      return { state: 'PAID', razorpayPaymentId: captured.id, detail: 'Payment captured' }
    }

    const authorized = payments.find((p) => p.status === 'authorized')
    if (authorized) {
      return { state: 'PAID', razorpayPaymentId: authorized.id, detail: 'Payment authorized' }
    }

    const failed = payments.find((p) => p.status === 'failed')
    if (failed) {
      return { state: 'FAILED', razorpayPaymentId: failed.id, detail: 'Payment failed at gateway' }
    }

    // No terminal payment yet — check the order itself.
    const order = await razorpay.orders.fetch(razorpayOrderId)
    if (order.status === 'paid') {
      return { state: 'PAID', detail: 'Order marked paid' }
    }

    return { state: 'UNKNOWN', detail: `No captured payment (order status: ${order.status})` }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { state: 'UNKNOWN', detail: `Could not reach Razorpay: ${message}` }
  }
}

/**
 * Create a hosted Razorpay Payment Link for an order (agent / MCP flow).
 * The amount is in paise. A human authenticates + pays on Razorpay's hosted page —
 * the link never charges autonomously. `reference_id` is our internal orderId so
 * webhooks and polling can reconcile back to the local order.
 */
export async function createRazorpayPaymentLink(opts: {
  orderId: string
  amountPaise: number
  description?: string
  referenceId?: string
  notes?: Record<string, string | number>
  callbackUrl?: string
}): Promise<{ id: string; shortUrl: string; status: string }> {
  const link = await razorpay.paymentLink.create({
    amount: opts.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: opts.referenceId,
    description: opts.description || `Payment for order ${opts.orderId}`,
    // Placeholder identity: the real payer authenticates and can edit their details
    // on Razorpay's hosted page. Notifications are off so nothing is sent here.
    customer: { name: 'Agentic Commerce Buyer', email: 'buyer@example.com', contact: '+919000000000' },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: opts.notes,
    ...(opts.callbackUrl ? { callback_url: opts.callbackUrl, callback_method: 'get' } : {}),
  })
  return { id: link.id, shortUrl: link.short_url, status: link.status }
}

/**
 * Reconcile a Razorpay Payment Link's real state — used by polling (get_order_status)
 * so local demos without a public webhook still confirm. Never creates a charge.
 */
export async function fetchRazorpayPaymentLinkState(paymentLinkId: string): Promise<{
  state: RazorpaySettlementState
  razorpayPaymentId?: string
  detail: string
}> {
  try {
    const link = await razorpay.paymentLink.fetch(paymentLinkId)

    if (link.status === 'paid') {
      // `payments` is documented as an array once populated; handle both shapes.
      const payments = link.payments as unknown
      let razorpayPaymentId: string | undefined
      if (Array.isArray(payments) && payments.length > 0) {
        razorpayPaymentId = (payments[0] as { payment_id?: string }).payment_id
      } else if (payments && typeof payments === 'object') {
        razorpayPaymentId = (payments as { payment_id?: string }).payment_id
      }
      return { state: 'PAID', razorpayPaymentId, detail: 'Payment link paid' }
    }

    if (link.status === 'cancelled' || link.status === 'expired') {
      return { state: 'FAILED', detail: `Payment link ${link.status}` }
    }

    return { state: 'UNKNOWN', detail: `Payment link status: ${link.status}` }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { state: 'UNKNOWN', detail: `Could not reach Razorpay: ${message}` }
  }
}
