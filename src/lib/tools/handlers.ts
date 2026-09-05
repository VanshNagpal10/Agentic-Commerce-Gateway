import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';
import { evaluatePolicy } from '@/lib/policy-engine';
import { transitionOrder } from '@/lib/state-machine';
import {
  razorpay,
  razorpayConfigured,
  verifyPaymentSignature,
  fetchRazorpayOrderState,
  createRazorpayPaymentLink,
  fetchRazorpayPaymentLinkState,
} from '@/lib/razorpay';
import { computeCartIdempotencyKey } from '@/lib/utils';

export interface ToolContext {
  merchantId: string;
  traceId: string;
  buyerIntent?: string;
  // Who is driving this call — used for honest audit attribution. Defaults to 'agent'.
  actor?: 'agent' | 'system' | 'merchant';
}

// ─── SEARCH PRODUCTS ────────────────────────────────────────

async function handleSearchProducts(args: Record<string, unknown>, context: ToolContext) {
  const { query, category, maxPrice, deliveryBy } = args as {
    query?: string;
    category?: string;
    maxPrice?: number;
    deliveryBy?: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: Record<string, any> = { merchantId: context.merchantId };

  if (query && query.trim()) {
    filters.OR = [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      { category: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (category && category.trim()) {
    if (filters.OR) {
      filters.AND = [
        { OR: filters.OR },
        { category: { contains: category, mode: 'insensitive' } },
      ];
      delete filters.OR;
    } else {
      filters.category = { contains: category, mode: 'insensitive' };
    }
  }
  if (maxPrice !== undefined) {
    filters.price = { lte: Math.round(maxPrice * 100) };
  }
  if (deliveryBy !== undefined) {
    filters.deliveryDays = { lte: deliveryBy };
  }

  const products = await db.product.findMany({ where: filters, take: 10 });

  return products.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    price: p.price / 100,
    pricePaise: p.price,
    stock: p.stock,
    deliveryDays: p.deliveryDays,
    description: p.description?.substring(0, 100) || '',
  }));
}

// ─── GET PRODUCT ────────────────────────────────────────────

async function handleGetProduct(args: Record<string, unknown>, context: ToolContext) {
  const { productId } = args as { productId: string };
  const product = await db.product.findFirst({
    where: { id: productId, merchantId: context.merchantId },
  });

  if (!product) throw new Error('Product not found');

  return {
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    price: product.price / 100,
    pricePaise: product.price,
    stock: product.stock,
    deliveryDays: product.deliveryDays,
    sku: product.sku,
    returnPolicy: product.returnPolicy,
    attributes: product.attributes,
  };
}

// ─── CHECK INVENTORY ────────────────────────────────────────

async function handleCheckInventory(args: Record<string, unknown>, context: ToolContext) {
  const { productId, quantity } = args as { productId: string; quantity: number };
  const product = await db.product.findFirst({
    where: { id: productId, merchantId: context.merchantId },
  });

  if (!product) throw new Error('Product not found');

  return {
    available: product.stock >= quantity,
    currentStock: product.stock,
    requestedQuantity: quantity,
    productTitle: product.title,
  };
}

// ─── QUOTE ORDER ────────────────────────────────────────────

interface OrderItem {
  productId: string;
  title: string;
  category: string;
  quantity: number;
  unitPrice: number;
}

const OPEN_ORDER_STATUSES = [
  'QUOTED',
  'POLICY_APPROVED',
  'PENDING_APPROVAL',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PAYMENT_UNKNOWN',
  'PAYMENT_SUCCESS',
] as const;

function summarizeOrder(order: {
  id: string;
  status: string;
  items: unknown;
  subtotal: number;
  total: number;
}) {
  const orderItems = (order.items as unknown as OrderItem[]) || [];
  const shipping = order.total - order.subtotal;
  return {
    orderId: order.id,
    status: order.status,
    items: orderItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice / 100,
    })),
    subtotal: order.subtotal / 100,
    shipping: shipping / 100,
    total: order.total / 100,
    totalPaise: order.total,
  };
}

async function handleQuoteOrder(args: Record<string, unknown>, context: ToolContext) {
  const { items } = args as { items: Array<{ productId: string; quantity: number }> };
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required');
  }

  // Deterministic idempotency: same cart + same trace → same order.
  const idempotencyKey = computeCartIdempotencyKey(context.merchantId, items, context.traceId);

  const existing = await db.order.findUnique({ where: { idempotencyKey } });
  if (existing && OPEN_ORDER_STATUSES.includes(existing.status as (typeof OPEN_ORDER_STATUSES)[number])) {
    return { ...summarizeOrder(existing), idempotent: true };
  }

  let subtotal = 0;
  const orderItems: OrderItem[] = [];

  for (const item of items) {
    const product = await db.product.findFirst({
      where: { id: item.productId, merchantId: context.merchantId },
    });

    if (!product) throw new Error(`Product ${item.productId} not found`);
    if (product.stock < item.quantity) {
      throw new Error(`Insufficient stock for ${product.title}. Available: ${product.stock}`);
    }

    subtotal += product.price * item.quantity;
    orderItems.push({
      productId: product.id,
      title: product.title,
      category: product.category,
      quantity: item.quantity,
      unitPrice: product.price,
    });
  }

  const shippingAmount = subtotal < 100000 ? 4999 : 0;
  const total = subtotal + shippingAmount;

  const order = await db.order.create({
    data: {
      merchantId: context.merchantId,
      status: 'QUOTED',
      items: JSON.parse(JSON.stringify(orderItems)),
      subtotal,
      total,
      idempotencyKey,
      traceId: context.traceId,
      buyerIntent: context.buyerIntent,
    },
  });

  return { ...summarizeOrder(order), idempotent: false };
}

// ─── CHECK POLICY ───────────────────────────────────────────

async function handleCheckPolicy(args: Record<string, unknown>, context: ToolContext) {
  const { action, amount, category, currentAttempts } = args as {
    action: 'purchase' | 'payment_retry';
    amount: number; // rupees (per updated tool schema)
    category?: string;
    currentAttempts?: number;
  };

  const amountPaise = Math.round((amount ?? 0) * 100);

  const decision = await evaluatePolicy({
    merchantId: context.merchantId,
    action,
    amount: amountPaise,
    category: category || undefined,
    currentAttempts,
  });

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'POLICY_DECISION',
    toolName: 'check_policy',
    input: { ...args, amountPaise },
    output: decision,
    policyDecision: decision.decision,
    policyReason: decision.reasons.join('; '),
  });

  return decision;
}

// ─── CREATE ORDER ───────────────────────────────────────────

async function handleCreateOrder(args: Record<string, unknown>, context: ToolContext) {
  const { quoteOrderId } = args as { quoteOrderId: string };

  const order = await db.order.findFirst({
    where: { id: quoteOrderId, merchantId: context.merchantId },
  });

  if (!order) throw new Error('Order not found');

  if (order.status !== 'QUOTED') {
    return {
      orderId: order.id,
      status: order.status,
      message: 'Order is already past QUOTED status — idempotent check',
    };
  }

  const orderItems = (order.items as unknown as OrderItem[]) || [];

  // Re-check inventory: stock may have vanished since the quote.
  for (const item of orderItems) {
    const product = await db.product.findFirst({
      where: { id: item.productId, merchantId: context.merchantId },
    });
    if (!product || product.stock < item.quantity) {
      await transitionOrder(order.id, 'CANCELLED', context.traceId, 'agent');
      await logAuditEvent({
        traceId: context.traceId,
        eventType: 'ERROR',
        toolName: 'create_order',
        input: { quoteOrderId },
        output: {
          reason: 'STOCK_UNAVAILABLE',
          product: item.title,
          available: product?.stock ?? 0,
          requested: item.quantity,
        },
      });
      return {
        orderId: order.id,
        status: 'CANCELLED',
        error: `Stock no longer available for ${item.title}. Order cancelled to avoid an unfulfillable purchase.`,
      };
    }
  }

  const categories = [...new Set(orderItems.map((i) => i.category))];

  const policyDecision = await evaluatePolicy({
    merchantId: context.merchantId,
    action: 'purchase',
    amount: order.total,
    categories,
  });

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'POLICY_DECISION',
    toolName: 'create_order',
    actor: 'agent',
    input: { quoteOrderId, amountPaise: order.total, categories },
    output: policyDecision,
    policyDecision: policyDecision.decision,
    policyReason: policyDecision.reasons.join('; '),
  });

  let newStatus = order.status as string;
  let transitionError: string | undefined;

  const target =
    policyDecision.decision === 'ALLOW'
      ? 'POLICY_APPROVED'
      : policyDecision.decision === 'APPROVAL_REQUIRED'
        ? 'PENDING_APPROVAL'
        : 'POLICY_DENIED';

  const result = await transitionOrder(order.id, target, context.traceId, 'agent');
  if (result.success) {
    newStatus = target;
  } else {
    transitionError = result.error;
  }

  return {
    orderId: order.id,
    status: newStatus,
    policyDecision: policyDecision.decision,
    reasons: policyDecision.reasons,
    ...(transitionError ? { error: transitionError } : {}),
  };
}

// ─── INITIATE PAYMENT ───────────────────────────────────────

async function handleInitiatePayment(args: Record<string, unknown>, context: ToolContext) {
  const { orderId } = args as { orderId: string };

  const order = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });

  if (!order) throw new Error('Order not found');

  if (order.status !== 'POLICY_APPROVED' && order.status !== 'PAYMENT_PENDING') {
    throw new Error(`Cannot initiate payment for order in ${order.status} status`);
  }

  if (!razorpayConfigured()) {
    throw new Error('Razorpay keys not configured — cannot initiate payment');
  }

  const merchant = await db.merchant.findUnique({ where: { id: context.merchantId } });

  // Re-check inventory before taking money.
  const orderItems = (order.items as unknown as OrderItem[]) || [];
  for (const item of orderItems) {
    const product = await db.product.findFirst({
      where: { id: item.productId, merchantId: context.merchantId },
    });
    if (!product || product.stock < item.quantity) {
      await transitionOrder(order.id, 'CANCELLED', context.traceId, 'agent');
      await logAuditEvent({
        traceId: context.traceId,
        eventType: 'ERROR',
        toolName: 'initiate_payment',
        input: { orderId },
        output: { reason: 'STOCK_UNAVAILABLE', product: item.title },
      });
      return {
        orderId: order.id,
        status: 'CANCELLED',
        error: `Stock no longer available for ${item.title}. Payment not initiated.`,
      };
    }
  }

  // Reuse an existing Razorpay order if one is already in flight — never double-create.
  const existingPayment = await db.payment.findFirst({
    where: {
      orderId: order.id,
      status: { in: ['INITIATED', 'PENDING'] },
      razorpayOrderId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });

  let razorpayOrderId: string;
  if (existingPayment?.razorpayOrderId) {
    razorpayOrderId = existingPayment.razorpayOrderId;
  } else {
    const rzpOrder = await razorpay.orders.create({
      amount: order.total,
      currency: 'INR',
      receipt: order.id,
      notes: { orderId: order.id, merchantId: context.merchantId, traceId: context.traceId },
    });
    razorpayOrderId = rzpOrder.id;

    await db.payment.create({
      data: {
        orderId: order.id,
        razorpayOrderId: rzpOrder.id,
        status: 'INITIATED',
        amount: order.total,
      },
    });
  }

  if (order.status === 'POLICY_APPROVED') {
    await transitionOrder(order.id, 'PAYMENT_PENDING', context.traceId, 'agent');
  }

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'PAYMENT_EVENT',
    toolName: 'initiate_payment',
    input: { orderId },
    output: {
      razorpayOrderId,
      amountPaise: order.total,
      reused: !!existingPayment?.razorpayOrderId,
    },
  });

  return {
    checkoutRequired: true,
    razorpayOrderId,
    internalOrderId: order.id,
    amountRupees: order.total / 100,
    amountPaise: order.total,
    currency: 'INR',
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    merchantName: merchant?.name || 'Merchant',
  };
}

// ─── CREATE PAYMENT LINK (agent / MCP handoff) ──────────────

/**
 * Produce a hosted Razorpay Payment Link for a policy-approved order. This is the
 * payment surface for agents without a browser (MCP / Claude): the link never
 * charges autonomously — a human authenticates + pays on Razorpay's hosted page,
 * and the order confirms via webhook or polling reconciliation (get_order_status).
 */
async function handleCreatePaymentLink(args: Record<string, unknown>, context: ToolContext) {
  const { orderId } = args as { orderId: string };

  const order = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });

  if (!order) throw new Error('Order not found');

  if (order.status !== 'POLICY_APPROVED' && order.status !== 'PAYMENT_PENDING') {
    throw new Error(
      `Cannot create a payment link for an order in ${order.status} status — it must be policy-approved first.`
    );
  }

  if (!razorpayConfigured()) {
    throw new Error('Razorpay keys not configured — cannot create a payment link');
  }

  // Re-check inventory before offering to take money.
  const orderItems = (order.items as unknown as OrderItem[]) || [];
  for (const item of orderItems) {
    const product = await db.product.findFirst({
      where: { id: item.productId, merchantId: context.merchantId },
    });
    if (!product || product.stock < item.quantity) {
      await transitionOrder(order.id, 'CANCELLED', context.traceId, context.actor ?? 'agent');
      await logAuditEvent({
        traceId: context.traceId,
        eventType: 'ERROR',
        toolName: 'create_payment_link',
        input: { orderId },
        output: { reason: 'STOCK_UNAVAILABLE', product: item.title },
      });
      return {
        orderId: order.id,
        status: 'CANCELLED',
        error: `Stock no longer available for ${item.title}. Payment link not created.`,
      };
    }
  }

  // Reuse an existing open link if one is already in flight — never create duplicates.
  const existing = await db.payment.findFirst({
    where: {
      orderId: order.id,
      razorpayPaymentLinkId: { not: null },
      status: { in: ['INITIATED', 'PENDING'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing?.razorpayPaymentLinkId) {
    const link = await razorpay.paymentLink.fetch(existing.razorpayPaymentLinkId);
    if (link.status === 'created') {
      return {
        paymentLinkUrl: link.short_url,
        paymentLinkId: link.id,
        orderId: order.id,
        amountRupees: order.total / 100,
        currency: 'INR',
        status: order.status,
        reused: true,
        message:
          "Share this link with the buyer. They authenticate and pay on Razorpay's secure hosted page; the order confirms automatically once paid.",
      };
    }
  }

  const link = await createRazorpayPaymentLink({
    orderId: order.id,
    amountPaise: order.total,
    referenceId: order.id,
    description: `Order ${order.id}`,
    notes: { orderId: order.id, merchantId: context.merchantId, traceId: context.traceId },
  });

  await db.payment.create({
    data: {
      orderId: order.id,
      razorpayPaymentLinkId: link.id,
      status: 'INITIATED',
      amount: order.total,
    },
  });

  if (order.status === 'POLICY_APPROVED') {
    await transitionOrder(order.id, 'PAYMENT_PENDING', context.traceId, context.actor ?? 'agent');
  }

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'PAYMENT_EVENT',
    toolName: 'create_payment_link',
    input: { orderId },
    output: { paymentLinkId: link.id, amountPaise: order.total },
  });

  return {
    paymentLinkUrl: link.shortUrl,
    paymentLinkId: link.id,
    orderId: order.id,
    amountRupees: order.total / 100,
    currency: 'INR',
    status: 'PAYMENT_PENDING',
    message:
      "Share this link with the buyer. They authenticate and pay on Razorpay's secure hosted page; the order confirms automatically once paid.",
  };
}

// ─── VERIFY PAYMENT (dual-mode) ─────────────────────────────

async function handleVerifyPayment(args: Record<string, unknown>, context: ToolContext) {
  const { orderId, razorpayPaymentId, razorpaySignature, razorpayOrderId } = args as {
    orderId: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    razorpayOrderId?: string;
  };

  const payment = await db.payment.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) throw new Error('Payment not found');

  const rzpOrderId = razorpayOrderId || payment.razorpayOrderId || '';

  // ── Mode A: signature verification (happy path) ──
  if (razorpayPaymentId && razorpaySignature && rzpOrderId) {
    const isValid = verifyPaymentSignature({
      orderId: rzpOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });

    if (isValid) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'VERIFIED', razorpayPaymentId },
      });
      await transitionOrder(orderId, 'PAYMENT_SUCCESS', context.traceId, 'agent');
      await logAuditEvent({
        traceId: context.traceId,
        eventType: 'PAYMENT_EVENT',
        toolName: 'verify_payment',
        input: { orderId, mode: 'signature' },
        output: { verified: true },
      });
      return { verified: true, paymentStatus: 'SUCCESS', orderId };
    }

    // Signature mismatch — fall through to status-fetch to learn the real state
    // instead of blindly marking failed.
    await logAuditEvent({
      traceId: context.traceId,
      eventType: 'PAYMENT_EVENT',
      toolName: 'verify_payment',
      input: { orderId, mode: 'signature' },
      output: { verified: false, reason: 'SIGNATURE_MISMATCH', fallingBackToStatusFetch: true },
    });
  }

  // ── Mode B: status-fetch (failure / unknown path) ──
  return await resolvePaymentByStatusFetch(orderId, rzpOrderId, payment.id, context, 'verify_payment');
}

// ─── GET PAYMENT STATUS ─────────────────────────────────────

async function handleGetPaymentStatus(args: Record<string, unknown>, context: ToolContext) {
  const { orderId } = args as { orderId: string };

  const payment = await db.payment.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) throw new Error('Payment not found for this order');

  return await resolvePaymentByStatusFetch(
    orderId,
    payment.razorpayOrderId || '',
    payment.id,
    context,
    'get_payment_status'
  );
}

/**
 * Idempotent, no-charge resolution: ask Razorpay what actually happened and
 * move the state machine accordingly. Shared by verify (mode B) and get_payment_status.
 */
async function resolvePaymentByStatusFetch(
  orderId: string,
  razorpayOrderId: string,
  paymentRowId: string,
  context: ToolContext,
  toolName: string
) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Order not found');

  // If already terminal, report without re-fetching.
  if (order.status === 'PAYMENT_SUCCESS' || order.status === 'CONFIRMED') {
    return { verified: true, paymentStatus: 'SUCCESS', orderId, orderStatus: order.status };
  }

  if (!razorpayOrderId || !razorpayConfigured()) {
    return {
      verified: false,
      paymentStatus: 'UNKNOWN',
      orderId,
      orderStatus: order.status,
      detail: 'No Razorpay order to query',
    };
  }

  const state = await fetchRazorpayOrderState(razorpayOrderId);

  if (state.state === 'PAID') {
    await db.payment.update({
      where: { id: paymentRowId },
      data: { status: 'VERIFIED', razorpayPaymentId: state.razorpayPaymentId },
    });
    // Move forward only along a valid path.
    if (order.status === 'PAYMENT_PENDING' || order.status === 'PAYMENT_UNKNOWN' || order.status === 'PAYMENT_FAILED') {
      await transitionOrder(orderId, 'PAYMENT_SUCCESS', context.traceId, 'agent');
    }
    await logAuditEvent({
      traceId: context.traceId,
      eventType: 'PAYMENT_EVENT',
      toolName,
      input: { orderId, mode: 'status_fetch' },
      output: { verified: true, razorpayState: state.state, detail: state.detail },
    });
    return { verified: true, paymentStatus: 'SUCCESS', orderId, detail: state.detail };
  }

  if (state.state === 'FAILED') {
    await db.payment.update({
      where: { id: paymentRowId },
      data: { status: 'FAILED', razorpayPaymentId: state.razorpayPaymentId, failureCode: 'GATEWAY_FAILED' },
    });
    if (order.status === 'PAYMENT_PENDING' || order.status === 'PAYMENT_UNKNOWN') {
      await transitionOrder(orderId, 'PAYMENT_FAILED', context.traceId, 'agent');
    }
    await logAuditEvent({
      traceId: context.traceId,
      eventType: 'PAYMENT_EVENT',
      toolName,
      input: { orderId, mode: 'status_fetch' },
      output: { verified: false, razorpayState: state.state, detail: state.detail },
    });
    return { verified: false, paymentStatus: 'FAILED', orderId, detail: state.detail };
  }

  // UNKNOWN — no charge captured. Record but do not retry-charge.
  await db.payment.update({ where: { id: paymentRowId }, data: { status: 'UNKNOWN' } });
  if (order.status === 'PAYMENT_PENDING') {
    await transitionOrder(orderId, 'PAYMENT_UNKNOWN', context.traceId, 'agent');
  }
  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'PAYMENT_EVENT',
    toolName,
    input: { orderId, mode: 'status_fetch' },
    output: { verified: false, razorpayState: 'UNKNOWN', detail: state.detail, reason: 'NO_CHARGE_CAPTURED' },
  });
  return {
    verified: false,
    paymentStatus: 'UNKNOWN',
    orderId,
    detail: `${state.detail}. No charge was captured — safe to retry within policy.`,
  };
}

// ─── GET ORDER STATUS ───────────────────────────────────────

/**
 * If this order is collecting payment via a Razorpay Payment Link, ask Razorpay
 * whether it has been paid and advance the state machine to match
 * (PAYMENT_PENDING → PAYMENT_SUCCESS → CONFIRMED). No-charge: the human already
 * authorized on Razorpay's hosted page. Idempotent — lets the local demo confirm
 * a link payment without a public webhook URL.
 */
async function reconcilePaymentLinkForOrder(orderId: string, context: ToolContext): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (order.status !== 'PAYMENT_PENDING' && order.status !== 'PAYMENT_UNKNOWN') return;

  const payment = await db.payment.findFirst({
    where: { orderId, razorpayPaymentLinkId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment?.razorpayPaymentLinkId || !razorpayConfigured()) return;

  const state = await fetchRazorpayPaymentLinkState(payment.razorpayPaymentLinkId);
  if (state.state !== 'PAID') return;

  await db.payment.update({
    where: { id: payment.id },
    data: { status: 'VERIFIED', razorpayPaymentId: state.razorpayPaymentId },
  });
  await transitionOrder(orderId, 'PAYMENT_SUCCESS', context.traceId, 'system');
  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'PAYMENT_EVENT',
    actor: 'system',
    toolName: 'get_order_status',
    input: { orderId, mode: 'payment_link_reconcile' },
    output: { verified: true, razorpayState: state.state, detail: state.detail },
  });

  // Auto-confirm: decrement stock → CONFIRMED. Non-fatal; can be retried.
  try {
    await handleConfirmOrder({ orderId }, { ...context, actor: 'system' });
  } catch (err) {
    await logAuditEvent({
      traceId: context.traceId,
      eventType: 'ERROR',
      actor: 'system',
      toolName: 'get_order_status',
      input: { orderId, mode: 'auto_confirm' },
      output: { error: err instanceof Error ? err.message : 'confirm failed' },
    });
  }
}

/**
 * Read-only lifecycle status of an order. Used when resuming a chat or after a
 * merchant approval, so the agent can decide whether to pay, wait, or inform the
 * buyer the order is already done. Never charges. If a payment link is outstanding,
 * it reconciles the link's real state first so the returned status is live.
 */
async function handleGetOrderStatus(args: Record<string, unknown>, context: ToolContext) {
  const { orderId } = args as { orderId: string };

  // Validate ownership before touching Razorpay.
  const owned = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });
  if (!owned) throw new Error('Order not found');

  // Reflect any completed payment-link payment before reporting status.
  await reconcilePaymentLinkForOrder(orderId, context);

  const order = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });
  if (!order) throw new Error('Order not found');

  const orderItems = (order.items as unknown as OrderItem[]) || [];

  return {
    orderId: order.id,
    orderStatus: order.status,
    total: order.total / 100,
    itemCount: orderItems.reduce((n, i) => n + i.quantity, 0),
    items: orderItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice / 100,
    })),
  };
}

// ─── CONFIRM ORDER ──────────────────────────────────────────

export async function handleConfirmOrder(args: Record<string, unknown>, context: ToolContext) {
  const { orderId } = args as { orderId: string };

  const order = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });

  if (!order) throw new Error('Order not found');
  if (order.status !== 'PAYMENT_SUCCESS') {
    throw new Error(`Cannot confirm order in ${order.status} status`);
  }

  const orderItems = (order.items as unknown as OrderItem[]) || [];

  // Transactional confirm + stock decrement so two confirms cannot double-decrement.
  try {
    await db.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({ where: { id: orderId } });
      if (!fresh || fresh.status !== 'PAYMENT_SUCCESS') {
        throw new Error('Order is no longer confirmable (already processed)');
      }

      for (const item of orderItems) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${item.title} at confirmation`);
        }
      }

      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      await tx.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Confirmation failed';
    await logAuditEvent({
      traceId: context.traceId,
      eventType: 'ERROR',
      toolName: 'confirm_order',
      input: { orderId },
      output: { error: message },
    });
    throw error;
  }

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'STATE_CHANGE',
    actor: context.actor ?? 'agent',
    input: { from: 'PAYMENT_SUCCESS', to: 'CONFIRMED' },
    output: { orderId, stockDecremented: true },
  });

  const confirmedOrder = await db.order.findUnique({ where: { id: orderId } });

  return {
    orderId: confirmedOrder!.id,
    status: 'CONFIRMED',
    confirmedAt: confirmedOrder!.updatedAt,
    items: orderItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice / 100,
    })),
    total: confirmedOrder!.total / 100,
  };
}

// ─── CANCEL ORDER ───────────────────────────────────────────

async function handleCancelOrder(args: Record<string, unknown>, context: ToolContext) {
  const { orderId, reason } = args as { orderId: string; reason?: string };

  const order = await db.order.findFirst({
    where: { id: orderId, merchantId: context.merchantId },
  });
  if (!order) throw new Error('Order not found');

  const result = await transitionOrder(orderId, 'CANCELLED', context.traceId, 'agent');
  if (!result.success) {
    return { orderId, status: order.status, error: result.error };
  }

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'STATE_CHANGE',
    actor: 'agent',
    toolName: 'cancel_order',
    input: { orderId, reason: reason || 'unspecified' },
    output: { status: 'CANCELLED' },
  });

  return { orderId, status: 'CANCELLED', reason: reason || 'unspecified' };
}

// ─── DISPATCHER ─────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  let result: Record<string, unknown>;

  try {
    switch (toolName) {
      case 'search_products':
        result = { products: await handleSearchProducts(args, context) };
        break;
      case 'get_product':
        result = { product: await handleGetProduct(args, context) };
        break;
      case 'check_inventory':
        result = await handleCheckInventory(args, context);
        break;
      case 'quote_order':
        result = await handleQuoteOrder(args, context);
        break;
      case 'check_policy':
        result = { ...(await handleCheckPolicy(args, context)) };
        break;
      case 'create_order':
        result = await handleCreateOrder(args, context);
        break;
      case 'initiate_payment':
        result = await handleInitiatePayment(args, context);
        break;
      case 'create_payment_link':
        result = await handleCreatePaymentLink(args, context);
        break;
      case 'verify_payment':
        result = await handleVerifyPayment(args, context);
        break;
      case 'get_payment_status':
        result = await handleGetPaymentStatus(args, context);
        break;
      case 'get_order_status':
        result = await handleGetOrderStatus(args, context);
        break;
      case 'confirm_order':
        result = await handleConfirmOrder(args, context);
        break;
      case 'cancel_order':
        result = await handleCancelOrder(args, context);
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    result = { error: message };
  }

  const latencyMs = Date.now() - startTime;

  await logAuditEvent({
    traceId: context.traceId,
    eventType: 'TOOL_CALL',
    toolName,
    input: args,
    output: result,
    latencyMs,
  });

  return result;
}
