import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/merchant/policies?merchantId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('merchantId');

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    const policy = await db.policy.findUnique({
      where: { merchantId },
    });

    if (!policy) {
      return NextResponse.json({ error: 'No policy found' }, { status: 404 });
    }

    // Convert paise to rupees for display
    return NextResponse.json({
      policy: {
        ...policy,
        maxAutoSpendRupees: policy.maxAutoSpend / 100,
        approvalThresholdRupees: policy.approvalThreshold / 100,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/merchant/policies — Update policy
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { merchantId, maxAutoSpend, approvalThreshold, maxDiscountPct, restrictedCategories, minStock, maxRetries } = body;

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }

    const policy = await db.policy.upsert({
      where: { merchantId },
      update: {
        ...(maxAutoSpend !== undefined && { maxAutoSpend: Math.round(maxAutoSpend * 100) }),
        ...(approvalThreshold !== undefined && { approvalThreshold: Math.round(approvalThreshold * 100) }),
        ...(maxDiscountPct !== undefined && { maxDiscountPct }),
        ...(restrictedCategories !== undefined && { restrictedCategories }),
        ...(minStock !== undefined && { minStock }),
        ...(maxRetries !== undefined && { maxRetries }),
      },
      create: {
        merchantId,
        maxAutoSpend: Math.round((maxAutoSpend || 5000) * 100),
        approvalThreshold: Math.round((approvalThreshold || 10000) * 100),
        maxDiscountPct: maxDiscountPct || 15,
        restrictedCategories: restrictedCategories || [],
        minStock: minStock || 2,
        maxRetries: maxRetries || 1,
      },
    });

    return NextResponse.json({
      policy: {
        ...policy,
        maxAutoSpendRupees: policy.maxAutoSpend / 100,
        approvalThresholdRupees: policy.approvalThreshold / 100,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
