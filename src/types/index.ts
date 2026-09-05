export enum OrderStatus {
  QUOTED = 'QUOTED',
  POLICY_APPROVED = 'POLICY_APPROVED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  POLICY_DENIED = 'POLICY_DENIED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_UNKNOWN = 'PAYMENT_UNKNOWN',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  INITIATED = 'INITIATED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  VERIFIED = 'VERIFIED'
}

export type PolicyDecision = 'ALLOW' | 'APPROVAL_REQUIRED' | 'DENY';

export interface PolicyCheckResult {
  decision: PolicyDecision;
  reasons: string[];
  ruleResults: {
    rule: string;
    passed: boolean;
    detail: string;
  }[];
}

export interface ToolCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface QuoteItem {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
}

export type AuditEventType = 'TOOL_CALL' | 'POLICY_DECISION' | 'STATE_CHANGE' | 'PAYMENT_EVENT' | 'ERROR';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Record<string, unknown>[];
  traceId?: string;
}
