import { NextRequest, NextResponse } from 'next/server';
import { executeToolCall } from '@/lib/tools/handlers';

/**
 * Status-fetch endpoint used by the client after a checkout timeout/dismissal.
 * Idempotent, never charges. Body: { merchantId, traceId, orderId }
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, traceId, orderId } = await req.json();

    if (!merchantId || !traceId || !orderId) {
      return NextResponse.json(
        { error: 'merchantId, traceId and orderId are required' },
        { status: 400 }
      );
    }

    const result = await executeToolCall(
      'get_payment_status',
      { orderId },
      { merchantId, traceId }
    );

    return NextResponse.json({ status: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
