import { db } from '@/lib/db';
import { PolicyCheckResult, PolicyDecision } from '@/types';

function parseRestrictedCategories(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function evaluatePolicy(params: {
  merchantId: string;
  action: 'purchase' | 'payment_retry' | 'refund';
  amount: number; // in paise
  category?: string; // single category (back-compat)
  categories?: string[]; // all categories in the cart
  discountPct?: number; // requested discount percent, if any
  currentAttempts?: number;
}): Promise<PolicyCheckResult> {
  const policy = await db.policy.findUnique({
    where: { merchantId: params.merchantId },
  });

  if (!policy) {
    return {
      decision: 'DENY',
      reasons: ['No merchant policy configured'],
      ruleResults: [
        { rule: 'Policy Config', passed: false, detail: 'No policy found for the merchant' },
      ],
    };
  }

  const reasons: string[] = [];
  const ruleResults: PolicyCheckResult['ruleResults'] = [];
  let finalDecision: PolicyDecision = 'ALLOW';

  // ─── Restricted categories (check ALL categories in the cart) ───
  const restrictedCategories = parseRestrictedCategories(policy.restrictedCategories);
  const cartCategories = [
    ...(params.categories ?? []),
    ...(params.category ? [params.category] : []),
  ].filter(Boolean);

  if (cartCategories.length > 0 && restrictedCategories.length > 0) {
    const hits = cartCategories.filter((c) => restrictedCategories.includes(c));
    if (hits.length > 0) {
      const unique = [...new Set(hits)];
      reasons.push(`Category restricted: ${unique.join(', ')}`);
      ruleResults.push({
        rule: 'Restricted Category',
        passed: false,
        detail: `Cart contains restricted categor${unique.length > 1 ? 'ies' : 'y'}: ${unique.join(', ')}`,
      });
      finalDecision = 'DENY';
    } else {
      ruleResults.push({ rule: 'Restricted Category', passed: true, detail: 'No restricted categories in cart' });
    }
  }

  // ─── Discount cap ───
  if (params.discountPct !== undefined) {
    if (params.discountPct > policy.maxDiscountPct) {
      reasons.push(`Discount ${params.discountPct}% exceeds max ${policy.maxDiscountPct}%`);
      ruleResults.push({
        rule: 'Discount Cap',
        passed: false,
        detail: `Requested ${params.discountPct}% exceeds max allowed ${policy.maxDiscountPct}%`,
      });
      finalDecision = 'DENY';
    } else {
      ruleResults.push({
        rule: 'Discount Cap',
        passed: true,
        detail: `Discount ${params.discountPct}% within max ${policy.maxDiscountPct}%`,
      });
    }
  }

  // ─── Spending limit ───
  if (params.amount <= policy.maxAutoSpend) {
    ruleResults.push({ rule: 'Spending Limit', passed: true, detail: 'Amount within auto-spend limit' });
  } else if (params.amount <= policy.approvalThreshold) {
    ruleResults.push({
      rule: 'Spending Limit',
      passed: false,
      detail: 'Amount exceeds auto-spend threshold, requires approval',
    });
    reasons.push('Amount exceeds auto-spend threshold');
    if (finalDecision !== 'DENY') {
      finalDecision = 'APPROVAL_REQUIRED';
    }
  } else {
    ruleResults.push({ rule: 'Spending Limit', passed: false, detail: 'Amount exceeds maximum approval limit' });
    reasons.push('Amount exceeds maximum allowed limit');
    finalDecision = 'DENY';
  }

  // ─── Retry limit ───
  if (params.action === 'payment_retry' && params.currentAttempts !== undefined) {
    if (params.currentAttempts >= policy.maxRetries) {
      ruleResults.push({ rule: 'Retry Limit', passed: false, detail: 'Max retries reached' });
      reasons.push('Retry limit reached');
      finalDecision = 'DENY';
    } else {
      ruleResults.push({ rule: 'Retry Limit', passed: true, detail: 'Attempts are within retry limit' });
    }
  }

  return {
    decision: finalDecision,
    reasons,
    ruleResults,
  };
}
