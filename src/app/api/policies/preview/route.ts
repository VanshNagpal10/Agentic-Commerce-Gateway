import { NextRequest, NextResponse } from 'next/server';
import { evaluatePolicy } from '@/lib/policy-engine';

/**
 * Runs the SAME deterministic policy engine used in production so the merchant's
 * "Live Preview" reflects real agent decisions, not a client-side guess.
 * Body: { merchantId, amount (rupees), category? }
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, amount, category } = await req.json();

    if (!merchantId || amount === undefined) {
      return NextResponse.json({ error: 'merchantId and amount required' }, { status: 400 });
    }

    const decision = await evaluatePolicy({
      merchantId,
      action: 'purchase',
      amount: Math.round(Number(amount) * 100),
      category: category || undefined,
    });

    return NextResponse.json({ decision });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
