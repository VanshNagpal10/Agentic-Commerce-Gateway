import { z } from 'zod';
import { toolDeclarations } from '@/lib/tools/definitions';

// Zod input schemas for the tools exposed over MCP.
//
// The official MCP SDK validates `tools/call` arguments against these BEFORE our
// handler runs, and generates the JSON Schema in `tools/list` from them — so an
// agent that sends a malformed call gets a proper JSON-RPC -32602 instead of our
// handler receiving junk.
//
// Descriptions are single-sourced from `toolDeclarations` (which also feeds the
// website's LLM tool loop), so the two surfaces can never disagree about what a
// tool does. Only the input *shapes* live here, in the form the SDK needs.

const rupees = (what: string) =>
  z.number().positive().describe(`${what} in RUPEES (not paise).`);

const productId = z.string().min(1).describe('The unique identifier of the product.');
const orderId = z.string().min(1).describe('The internal order ID.');

export const MCP_TOOL_SHAPES = {
  search_products: {
    query: z
      .string()
      .min(1)
      .describe('Free-text search across product name, description, and category (e.g. "running shoes").'),
    category: z.string().optional().describe('Restrict to a specific category slug (e.g. "running_shoes").'),
    maxPrice: rupees('Maximum price').optional(),
    deliveryBy: z.number().int().positive().optional().describe('Maximum acceptable delivery time in days.'),
  },

  get_product: {
    productId,
  },

  check_inventory: {
    productId,
    quantity: z.number().int().positive().describe('The desired quantity to check.'),
  },

  quote_order: {
    items: z
      .array(
        z.object({
          productId,
          quantity: z.number().int().positive().describe('The quantity of the product.'),
        })
      )
      .min(1)
      .describe('List of items to include in the quote.'),
  },

  check_policy: {
    action: z.enum(['purchase', 'payment_retry']).describe('The action to check.'),
    amount: rupees('The transaction amount'),
    category: z.string().optional().describe('Category of the product being purchased.'),
    currentAttempts: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Number of payment attempts so far — only relevant for payment_retry.'),
  },

  create_order: {
    quoteOrderId: z.string().min(1).describe('The order ID returned from quote_order.'),
  },

  get_order_status: {
    orderId,
  },

  create_payment_link: {
    orderId,
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOL_SHAPES;

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_SHAPES) as McpToolName[];

/**
 * Description for an MCP tool, taken from the shared declarations so the MCP
 * surface and the website's LLM surface describe every tool identically.
 * Throws at module load if a name drifts out of `toolDeclarations`.
 */
export function describeTool(name: McpToolName): string {
  const declared = toolDeclarations.find((t) => t.name === name);
  if (!declared) {
    throw new Error(`MCP tool "${name}" has no entry in toolDeclarations — the surfaces have drifted.`);
  }
  return declared.description;
}
