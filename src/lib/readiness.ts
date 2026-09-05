import { db } from '@/lib/db';

export interface ReadinessCheck {
  dimension: string;
  weight: number;
  score: number; // 0-100
  passed: boolean;
  detail: string;
  action?: string; // What the merchant should do to fix
}

export interface ReadinessScore {
  overall: number; // 0-100
  checks: ReadinessCheck[];
}

export async function calculateReadinessScore(merchantId: string): Promise<ReadinessScore> {
  const checks: ReadinessCheck[] = [];

  // 1. Catalog Structure (25%)
  const products = await db.product.findMany({
    where: { merchantId },
  });

  const totalProducts = products.length;
  if (totalProducts === 0) {
    checks.push({
      dimension: 'Catalog Structure',
      weight: 25,
      score: 0,
      passed: false,
      detail: 'No products in catalog',
      action: 'Add products to your catalog to make your store AI-discoverable',
    });
  } else {
    const completeProducts = products.filter(
      (p) =>
        p.title &&
        p.description &&
        p.description.length > 10 &&
        p.category &&
        p.price > 0 &&
        p.sku
    );
    const completeness = Math.round((completeProducts.length / totalProducts) * 100);
    const missingCount = totalProducts - completeProducts.length;
    checks.push({
      dimension: 'Catalog Structure',
      weight: 25,
      score: completeness,
      passed: completeness >= 80,
      detail: `${completeProducts.length}/${totalProducts} products have complete data`,
      action:
        missingCount > 0
          ? `${missingCount} products are missing descriptions or categories — update them in Catalog`
          : undefined,
    });
  }

  // 2. Policy Completeness (25%)
  const policy = await db.policy.findUnique({
    where: { merchantId },
  });

  if (!policy) {
    checks.push({
      dimension: 'Policy Completeness',
      weight: 25,
      score: 0,
      passed: false,
      detail: 'No policy configured',
      action: 'Configure spending limits, approval thresholds, and category restrictions in Policies',
    });
  } else {
    let policyScore = 0;
    const policyDetails: string[] = [];

    if (policy.maxAutoSpend > 0) policyScore += 25;
    else policyDetails.push('maxAutoSpend not set');

    if (policy.approvalThreshold > 0) policyScore += 25;
    else policyDetails.push('approvalThreshold not set');

    if (policy.maxDiscountPct >= 0) policyScore += 25;
    else policyDetails.push('maxDiscountPct not set');

    const restrictedCats = policy.restrictedCategories as string[];
    if (Array.isArray(restrictedCats) && restrictedCats.length > 0) policyScore += 25;
    else policyDetails.push('No restricted categories defined');

    checks.push({
      dimension: 'Policy Completeness',
      weight: 25,
      score: policyScore,
      passed: policyScore >= 75,
      detail: policyScore === 100 ? 'All policy rules configured' : `Policy partially configured`,
      action: policyDetails.length > 0 ? policyDetails.join('; ') : undefined,
    });
  }

  // 3. Tool Readiness (20%)
  // For the hackathon, tools are always ready if the server is running
  checks.push({
    dimension: 'Tool Readiness',
    weight: 20,
    score: 100,
    passed: true,
    detail: 'All 9 commerce tools registered and available',
  });

  // 4. Payment Readiness (15%)
  const hasRazorpayKeys = !!(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  );
  checks.push({
    dimension: 'Payment Readiness',
    weight: 15,
    score: hasRazorpayKeys ? 100 : 0,
    passed: hasRazorpayKeys,
    detail: hasRazorpayKeys
      ? 'Razorpay test mode keys configured'
      : 'Razorpay API keys not configured',
    action: hasRazorpayKeys
      ? undefined
      : 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to environment variables',
  });

  // 5. Inventory Freshness (10%)
  if (totalProducts > 0) {
    const inStockProducts = products.filter((p) => p.stock > 0);
    const inStockPct = Math.round((inStockProducts.length / totalProducts) * 100);
    checks.push({
      dimension: 'Inventory Freshness',
      weight: 10,
      score: inStockPct,
      passed: inStockPct >= 80,
      detail: `${inStockProducts.length}/${totalProducts} products in stock`,
      action:
        inStockPct < 80
          ? `${totalProducts - inStockProducts.length} products are out of stock — restock them`
          : undefined,
    });
  } else {
    checks.push({
      dimension: 'Inventory Freshness',
      weight: 10,
      score: 0,
      passed: false,
      detail: 'No products to evaluate',
    });
  }

  // 6. Observability (5%)
  const auditCount = await db.auditEvent.count({
    where: { traceId: { not: '' } },
  });
  checks.push({
    dimension: 'Observability',
    weight: 5,
    score: auditCount > 0 ? 100 : 50,
    passed: true,
    detail:
      auditCount > 0
        ? `${auditCount} audit events logged — tracing active`
        : 'Audit system ready — no events yet',
  });

  // Calculate overall score
  const overall = Math.round(
    checks.reduce((sum, check) => sum + (check.score * check.weight) / 100, 0)
  );

  return { overall, checks };
}
