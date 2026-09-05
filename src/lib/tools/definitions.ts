
export const toolDeclarations = [
  {
    name: 'search_products',
    description:
      'Search the product catalog. Filter by free-text query, category, maximum price (in rupees), and/or maximum delivery days. Returns real prices, stock, and delivery estimates.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text search across product name, description, and category (e.g. "running shoes"). Optional but recommended.',
        },
        category: {
          type: 'string',
          description: 'Restrict to a specific category slug (e.g. "running_shoes").',
        },
        maxPrice: {
          type: 'number',
          description: 'Maximum price in RUPEES (e.g. 5000 for ₹5,000). Optional.',
        },
        deliveryBy: {
          type: 'number',
          description: 'Maximum acceptable delivery time in days. Optional.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Get full product details including price, description, category, and inventory status.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The unique identifier of the product.' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'check_inventory',
    description: 'Check stock availability for a specific product and quantity.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The unique identifier of the product.' },
        quantity: { type: 'number', description: 'The desired quantity to check.' },
      },
      required: ['productId', 'quantity'],
    },
  },
  {
    name: 'quote_order',
    description:
      'Create a price quote for a list of items and get an orderId. Re-quoting the identical cart in the same session returns the same order (idempotent).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of items to include in the quote.',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'The unique identifier of the product.' },
              quantity: { type: 'number', description: 'The quantity of the product.' },
            },
            required: ['productId', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'check_policy',
    description:
      'Check if an action is allowed by merchant policy. Call before creating an order. Returns ALLOW, APPROVAL_REQUIRED, or DENY with reasons.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['purchase', 'payment_retry'],
          description: 'The action to check.',
        },
        amount: {
          type: 'number',
          description: 'The transaction amount in RUPEES (e.g. 4499 for ₹4,499). NOT paise.',
        },
        category: {
          type: 'string',
          description: 'Optional. Category of the product being purchased.',
        },
        currentAttempts: {
          type: 'number',
          description: 'Optional. Number of payment attempts so far — only relevant for payment_retry.',
        },
      },
      required: ['action', 'amount'],
    },
  },
  {
    name: 'create_order',
    description:
      'Promote a quote to an order. Re-checks inventory and runs the policy engine, then transitions the order to POLICY_APPROVED, PENDING_APPROVAL, or POLICY_DENIED.',
    parameters: {
      type: 'object',
      properties: {
        quoteOrderId: { type: 'string', description: 'The order ID returned from quote_order.' },
      },
      required: ['quoteOrderId'],
    },
  },
  {
    name: 'initiate_payment',
    description:
      'Start Razorpay checkout for a POLICY_APPROVED order. Returns checkout details for the client to open the payment popup. Reuses an existing Razorpay order if one is already in flight (never double-charges). Do NOT call this again after a payment uncertainty — use get_payment_status instead.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The internal order ID to pay for.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'create_payment_link',
    description:
      "Create a hosted Razorpay Payment Link for a POLICY_APPROVED order. Use this when there is no in-page browser checkout (e.g. an external AI agent). Returns a secure URL the human opens to authenticate and pay — it never charges autonomously. The order confirms automatically once the link is paid (poll get_order_status to see the live status). Reuses an existing open link (never creates duplicates).",
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The internal order ID to collect payment for.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'verify_payment',
    description:
      'Verify a payment. If the client provides Razorpay signature fields, verifies via HMAC (happy path). Otherwise fetches the real status from Razorpay (recovery path). Never creates a new charge.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Our internal order ID.' },
        razorpayPaymentId: { type: 'string', description: 'Payment ID from Razorpay (if available).' },
        razorpayOrderId: { type: 'string', description: 'Razorpay order ID (if available).' },
        razorpaySignature: { type: 'string', description: 'Signature from Razorpay (if available).' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'get_payment_status',
    description:
      'Fetch the actual payment state from Razorpay for an order. Idempotent and never charges. ALWAYS call this after a payment timeout or uncertainty BEFORE considering any retry.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The internal order ID to check.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'get_order_status',
    description:
      'Read the current lifecycle status of an existing order (e.g. after a merchant approval, or when resuming a chat). Read-only, never charges. Returns the live status so you can decide whether to pay, wait for approval, or inform the buyer it is already confirmed.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The internal order ID to check.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'confirm_order',
    description: 'Confirm an order after payment verified as SUCCESS. Decrements stock transactionally.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to confirm.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an order that cannot proceed (e.g. stock gone, retries exhausted). Only if not already terminal.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to cancel.' },
        reason: { type: 'string', description: 'Why the order is being cancelled.' },
      },
      required: ['orderId'],
    },
  },
];

export function getToolDeclarations() {
  return toolDeclarations;
}
