import { NextRequest, NextResponse } from 'next/server';
import { executeToolCall } from '@/lib/tools/handlers';
import { db } from '@/lib/db';

/**
 * Dedicated verify+confirm endpoint so payment confirmation cannot be skipped
 * if the LLM flakes. Called directly by the Razorpay Checkout success handler.
 *
 * Body: { merchantId, traceId, orderId, razorpay_order_id?, razorpay_payment_id?, razorpay_signature? }
 * If signature fields are omitted, verify runs in status-fetch mode (recovery path).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      merchantId,
      traceId,
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    if (!merchantId || !traceId || !orderId) {
      return NextResponse.json(
        { error: 'merchantId, traceId and orderId are required' },
        { status: 400 }
      );
    }

    const context = { merchantId, traceId };

    const verifyResult = await executeToolCall(
      'verify_payment',
      {
        orderId,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
      context
    );

    let confirmResult: Record<string, unknown> | null = null;
    if (verifyResult.verified === true) {
      confirmResult = await executeToolCall('confirm_order', { orderId }, context);
    }

    const order = await db.order.findUnique({ where: { id: orderId } });

    return NextResponse.json({
      verify: verifyResult,
      confirm: confirmResult,
      orderStatus: order?.status ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
