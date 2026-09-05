import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { slugify } from '@/lib/utils';

// POST /api/products — Add a product to the merchant's catalog.
// Price is received in RUPEES (console form) and stored in paise, matching the
// /api/merchant/policies convention. Category is normalized to a slug
// ("T Shirts" → "t_shirts") so agent search and policy category rules match.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      merchantId,
      title,
      description,
      category,
      price,
      stock,
      deliveryDays,
      sku,
    } = body as {
      merchantId?: string;
      title?: string;
      description?: string;
      category?: string;
      price?: number;
      stock?: number;
      deliveryDays?: number;
      sku?: string;
    };

    if (!merchantId) {
      return NextResponse.json({ error: 'merchantId required' }, { status: 400 });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Product title is required' }, { status: 400 });
    }
    if (!category || typeof category !== 'string' || !category.trim()) {
      return NextResponse.json({ error: 'Product category is required' }, { status: 400 });
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Price must be a positive number (in rupees)' }, { status: 400 });
    }
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      return NextResponse.json({ error: 'Stock must be a non-negative integer' }, { status: 400 });
    }

    const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) {
      return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    }

    // Category slug ("T Shirts" → "t_shirts") to match seeded category style.
    const categorySlug = slugify(category).replace(/-/g, '_');
    if (!categorySlug) {
      return NextResponse.json({ error: 'Category must contain letters or numbers' }, { status: 400 });
    }

    // Default SKU from the catalog size so merchants can skip it.
    const count = await db.product.count({ where: { merchantId } });
    const finalSku = (sku && sku.trim()) || `PRD-${String(count + 1).padStart(3, '0')}`;

    const product = await db.product.create({
      data: {
        merchantId,
        sku: finalSku,
        title: title.trim(),
        description: (description || '').trim() || `${title.trim()} available at ${merchant.name}.`,
        category: categorySlug,
        price: Math.round(price * 100), // rupees → paise
        stock,
        deliveryDays: typeof deliveryDays === 'number' && deliveryDays > 0 ? Math.round(deliveryDays) : 5,
        returnPolicy: '7-day return',
        attributes: {},
      },
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/products?id=xxx&merchantId=xxx — Remove a product from the
// merchant's catalog. Ownership-checked; past orders keep their item snapshot
// (items are stored as JSON on the order), so history stays intact.
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('id');
    const merchantId = searchParams.get('merchantId');

    if (!productId || !merchantId) {
      return NextResponse.json({ error: 'id and merchantId required' }, { status: 400 });
    }

    const product = await db.product.findFirst({
      where: { id: productId, merchantId },
    });
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    await db.product.delete({ where: { id: product.id } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
