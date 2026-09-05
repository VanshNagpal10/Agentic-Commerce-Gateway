import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { transitionOrder } from '@/lib/state-machine';
import { logAuditEvent } from '@/lib/audit';
import { handleConfirmOrder } from '@/lib/tools/handlers';

/**
 * Razorpay webhook. Verifies X-Razorpay-Signature with RAZORPAY_WEBHOOK_SECRET.
 * If the secret isn't configured, we skip silently (returns 200) so local demos
 * without webhooks still work. Idempotent on razorpayPaymentId.
 *
 * Handles both first-party checkout (payment.captured / order.paid, matched by
 * razorpayOrderId) and the agent/MCP payment-link flow (payment_link.paid,
 * matched by payment link id / reference_id). On any success it also auto-confirms
 * (decrements stock → CONFIRMED) so an order completes even with no client attached.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ skipped: 'webhook secret not configured' });
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; status?: string } };
      order?: { entity?: { id?: string } };
      payment_link?: { entity?: { id?: string; reference_id?: string; status?: string } };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event;
  const paymentEntity = event.payload?.payment?.entity;
  const linkEntity = event.payload?.payment_link?.entity;

  // Match the local payment: payment-link events by link id / reference_id (our
  // orderId), otherwise by razorpayOrderId.
  let payment: Awaited<ReturnType<typeof db.payment.findFirst>> = null;
  if (linkEntity?.id) {
    payment = await db.payment.findFirst({
      where: { razorpayPaymentLinkId: linkEntity.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment && linkEntity.reference_id) {
      payment = await db.payment.findFirst({
        where: { orderId: linkEntity.reference_id, razorpayPaymentLinkId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
    }
  }
  if (!payment) {
    const razorpayOrderId = paymentEntity?.order_id || event.payload?.order?.entity?.id;
    if (razorpayOrderId) {
      payment = await db.payment.findFirst({
        where: { razorpayOrderId },
        orderBy: { createdAt: 'desc' },
      });
    }
  }

  if (!payment) {
    return NextResponse.json({ skipped: 'no matching local payment' });
  }

  const order = await db.order.findUnique({ where: { id: payment.orderId } });
  if (!order) {
    return NextResponse.json({ skipped: 'no matching local order' });
  }

  // Idempotent: if we already recorded this payment id as verified, do nothing.
  if (
    paymentEntity?.id &&
    payment.razorpayPaymentId === paymentEntity.id &&
    (payment.status === 'VERIFIED' || payment.status === 'SUCCESS')
  ) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  const isSuccess =
    eventType === 'payment.captured' ||
    eventType === 'order.paid' ||
    eventType === 'payment_link.paid';

  if (isSuccess) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'VERIFIED', razorpayPaymentId: paymentEntity?.id ?? payment.razorpayPaymentId },
    });
    if (['PAYMENT_PENDING', 'PAYMENT_UNKNOWN', 'PAYMENT_FAILED'].includes(order.status)) {
      await transitionOrder(order.id, 'PAYMENT_SUCCESS', order.traceId, 'system');
    }
    await logAuditEvent({
      traceId: order.traceId,
      eventType: 'PAYMENT_EVENT',
      actor: 'system',
      toolName: 'webhook',
      input: { event: eventType, razorpayPaymentLinkId: linkEntity?.id, razorpayOrderId: paymentEntity?.order_id },
      output: { verified: true },
    });

    // Auto-confirm: decrement stock → CONFIRMED. Idempotent + non-fatal (the
    // client may also confirm; whichever runs first wins, the other is a no-op).
    try {
      await handleConfirmOrder(
        { orderId: order.id },
        { merchantId: order.merchantId, traceId: order.traceId, actor: 'system' }
      );
    } catch {
      // Already confirmed or transient — safe to ignore; state stays PAYMENT_SUCCESS.
    }
  } else if (eventType === 'payment.failed') {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureCode: 'WEBHOOK_FAILED', razorpayPaymentId: paymentEntity?.id ?? payment.razorpayPaymentId },
    });
    if (['PAYMENT_PENDING', 'PAYMENT_UNKNOWN'].includes(order.status)) {
      await transitionOrder(order.id, 'PAYMENT_FAILED', order.traceId, 'system');
    }
    await logAuditEvent({
      traceId: order.traceId,
      eventType: 'PAYMENT_EVENT',
      actor: 'system',
      toolName: 'webhook',
      input: { event: eventType, razorpayOrderId: paymentEntity?.order_id },
      output: { verified: false },
    });
  }

  return NextResponse.json({ ok: true });
}
