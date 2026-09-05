import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { slugify } from '@/lib/utils';

// GET /api/merchant?id=xxx — Get merchant details
// GET /api/merchant?id=xxx&include=products — Include products
// GET /api/merchant?id=xxx&include=policy — Include policy
// GET /api/merchant — List all merchants
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantId = searchParams.get('id');
    const include = searchParams.get('include');

    if (!merchantId) {
      const merchants = await db.merchant.findMany({
        include: { policies: true, _count: { select: { products: true, orders: true } } },
      });
      return NextResponse.json({ merchants });
    }

    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      include: {
        products: include === 'products' ? true : false,
        policies: include === 'policy' ? true : false,
        _count: { select: { products: true, orders: true } },
      },
    });

    if (!merchant) {
      return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    }

    return NextResponse.json({ merchant });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/merchant — Onboard a new store: { name, handle? }
// Creates the merchant plus a sane default policy in one transaction, so a
// freshly onboarded store is immediately sellable to AI agents through /api/mcp.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, handle } = body as { name?: string; handle?: string };

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Store name is required' }, { status: 400 });
    }

    const slug = slugify(handle || name);
    if (!slug) {
      return NextResponse.json({ error: 'Store handle must contain letters or numbers' }, { status: 400 });
    }
    const id = `merchant_${slug}`;

    const existing = await db.merchant.findUnique({ where: { id } });
    if (existing) {
      return NextResponse.json({ error: 'A store with this handle already exists' }, { status: 409 });
    }

    const merchant = await db.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: { id, name: name.trim(), aiEnabled: true, currency: 'INR' },
      });
      // Default guardrails — the merchant tunes these on the Policies page.
      await tx.policy.create({
        data: {
          merchantId: created.id,
          maxAutoSpend: 500000, // ₹5,000
          approvalThreshold: 1000000, // ₹10,000
          maxDiscountPct: 15,
          restrictedCategories: [],
          minStock: 2,
          maxRetries: 1,
        },
      });
      return created;
    });

    return NextResponse.json({ merchant }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/merchant — Update merchant
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, aiEnabled, storeUrl } = body;

    if (!id) {
      return NextResponse.json({ error: 'Merchant ID required' }, { status: 400 });
    }

    const merchant = await db.merchant.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(aiEnabled !== undefined && { aiEnabled }),
        ...(storeUrl !== undefined && { storeUrl }),
      },
    });

    return NextResponse.json({ merchant });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
