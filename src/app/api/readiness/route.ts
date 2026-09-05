import { NextRequest, NextResponse } from 'next/server';
import { calculateReadinessScore } from '@/lib/readiness';

// GET /api/readiness?merchantId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    const score = await calculateReadinessScore(merchantId);
    return NextResponse.json(score);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
