'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Loader2, ChevronDown, ChevronRight, ShoppingBag, ArrowRight,
  Plus, MessageSquare, Trash2, CheckCircle2, AlertTriangle, CreditCard,
} from 'lucide-react';
import { useMerchant } from '@/lib/merchant-context';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  openRazorpayCheckout,
  loadRazorpayScript,
  type CheckoutSuccess,
} from '@/components/RazorpayCheckout';

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  latencyMs: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  traceId?: string;
}

interface SessionState {
  quoteOrderId?: string;
  orderId?: string;
  razorpayOrderId?: string;
  lastStatus?: string;
}

interface SessionSummary {
  traceId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export default function BuyerChatPage() {
  const { merchantId, merchantName, merchants, setMerchantId } = useMerchant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [currentTraceId, setCurrentTraceId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>({});
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [paymentBanner, setPaymentBanner] = useState<
    { kind: 'success' | 'pending' | 'failed'; text: string } | null
  >(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  // Preload the checkout script so the popup opens instantly later.
  useEffect(() => { loadRazorpayScript(); }, []);

  const LS_KEY = 'acg_active_trace';

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/sessions?merchantId=${merchantId}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // non-fatal
    }
  }, [merchantId]);

  const loadSession = useCallback(async (traceId: string) => {
    try {
      const res = await fetch(`/api/chat/sessions?traceId=${traceId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setMessages(data.messages || []);
          setHistory((data.messages || []).map((m: Message) => ({ role: m.role, content: m.content })));
          setCurrentTraceId(traceId);
          setSessionState((data.session.sessionState as SessionState) || {});
          if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, traceId);
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  // On mount / merchant change: refresh session list and restore the last active chat.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSessions();
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_KEY);
      if (saved && !currentTraceId) {
        loadSession(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  const toggleToolExpand = (key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runVerify = useCallback(
    async (orderId: string, traceId: string, resp?: CheckoutSuccess) => {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId, traceId, orderId, ...(resp || {}) }),
      });
      return res.ok ? await res.json() : null;
    },
    [merchantId]
  );

  const checkStatus = useCallback(
    async (orderId: string, traceId: string) => {
      const res = await fetch('/api/payments/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId, traceId, orderId }),
      });
      return res.ok ? await res.json() : null;
    },
    [merchantId]
  );

  const appendAssistant = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  };

  // Handle a payment: open the real Razorpay checkout, then verify/confirm
  // server-side. On dismissal we reconcile real status — never re-initiate on
  // uncertainty, so we can't double-charge.
  const handlePayment = useCallback(
    async (payInfo: Record<string, unknown>, traceId: string) => {
      const orderId = payInfo.internalOrderId as string;
      const keyId = payInfo.keyId as string | undefined;

      if (!orderId || !keyId) {
        appendAssistant('Payment could not start — checkout is not configured.');
        return;
      }

      // Real checkout popup.
      setPaymentBanner({ kind: 'pending', text: 'Opening secure Razorpay checkout...' });
      await openRazorpayCheckout(
        {
          keyId,
          razorpayOrderId: payInfo.razorpayOrderId as string,
          amountPaise: payInfo.amountPaise as number,
          merchantName: (payInfo.merchantName as string) || merchantName,
          internalOrderId: orderId,
        },
        async (resp) => {
          setPaymentBanner({ kind: 'pending', text: 'Verifying payment...' });
          const result = await runVerify(orderId, traceId, resp);
          if (result?.orderStatus === 'CONFIRMED') {
            setPaymentBanner({ kind: 'success', text: 'Payment verified — order confirmed.' });
            appendAssistant('Payment verified and your order is confirmed. Thank you!');
          } else {
            setPaymentBanner({ kind: 'failed', text: `Payment could not be confirmed (${result?.verify?.paymentStatus || 'unknown'}).` });
            appendAssistant('I could not confirm the payment. No duplicate charge will be made — please check status or retry.');
          }
          fetchSessions();
        },
        async () => {
          // Dismissed — resolve real status instead of assuming failure.
          setPaymentBanner({ kind: 'pending', text: 'Checkout closed — checking payment status...' });
          const statusRes = await checkStatus(orderId, traceId);
          const status = statusRes?.status;
          if (status?.paymentStatus === 'SUCCESS') {
            await runVerify(orderId, traceId);
            setPaymentBanner({ kind: 'success', text: 'Payment was already captured — order confirmed.' });
          } else {
            setPaymentBanner({ kind: 'failed', text: 'Payment not completed — we will not charge twice.' });
          }
          fetchSessions();
        }
      );
    },
    [merchantName, checkStatus, runVerify, fetchSessions]
  );

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;

    setInput('');
    setPaymentBanner(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          merchantId,
          history,
          traceId: currentTraceId,
          sessionState,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        appendAssistant(`Error: ${data.error || 'Something went wrong'}`);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.response, toolCalls: data.toolCalls, traceId: data.traceId },
        ]);
        setHistory(data.history || []);
        setCurrentTraceId(data.traceId);
        setSessionState(data.sessionState || {});
        if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, data.traceId);

        // If the agent initiated payment, drive checkout from the client.
        const payCall = (data.toolCalls as ToolCall[] | undefined)?.find(
          (tc) => tc.toolName === 'initiate_payment' && tc.result?.checkoutRequired
        );
        if (payCall) {
          handlePayment(payCall.result, data.traceId);
        }
        fetchSessions();
      }
    } catch {
      appendAssistant('Failed to connect to the server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setHistory([]);
    setCurrentTraceId(null);
    setSessionState({});
    setPaymentBanner(null);
    if (typeof window !== 'undefined') localStorage.removeItem(LS_KEY);
  };

  const deleteSession = async (traceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/chat/sessions?traceId=${traceId}`, { method: 'DELETE' });
    if (traceId === currentTraceId) startNewChat();
    fetchSessions();
  };

  const suggestions = merchantId === 'merchant_techmart'
    ? ['Show me smartphones', 'I need a laptop', 'What accessories do you have?']
    : ['Show me running shoes under ₹5,000', 'I need a yoga mat', 'Buy a ₹2000 gift card'];

  return (
    <div className="flex h-screen chat-bg">
      {/* Session sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-100">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 bg-[#2B6CB0] hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-semibold transition"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1">
            Previous chats
          </p>
          {sessions.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-2">No chats yet.</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.traceId}
              onClick={() => loadSession(s.traceId)}
              className={`w-full group flex items-center gap-2 px-2 py-2 rounded-lg text-left text-[13px] transition ${
                s.traceId === currentTraceId
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-gray-600 hover:bg-gray-50 border border-transparent'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
              <span className="truncate flex-1">{s.title}</span>
              <Trash2
                onClick={(e) => deleteSession(s.traceId, e)}
                className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 flex-shrink-0"
              />
            </button>
          ))}
        </div>
      </aside>

      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center backdrop-blur-xs border border-white/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI Buyer Agent</h1>
              <p className="text-xs text-blue-100">
                Reference client — same governed gateway external agents use · Razorpay Test Mode
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={merchantId}
              onChange={(e) => { setMerchantId(e.target.value); startNewChat(); }}
              className="text-sm bg-white/15 hover:bg-white/20 text-white border border-white/30 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer transition backdrop-blur-xs font-medium"
            >
              {merchants.map((m) => (
                <option key={m.id} value={m.id} className="text-gray-900 bg-white">{m.name}</option>
              ))}
            </select>
            <Link
              href="/"
              className="text-sm font-medium text-white bg-white/15 hover:bg-white/25 border border-white/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition backdrop-blur-xs shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Sell here</span>
            </Link>
            <Link
              href="/merchant"
              className="text-sm font-medium text-white bg-white/15 hover:bg-white/25 border border-white/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition backdrop-blur-xs shadow-xs"
            >
              <span>Merchant Console</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </header>

        {/* Payment banner */}
        {paymentBanner && (
          <div
            className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 border-b ${
              paymentBanner.kind === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : paymentBanner.kind === 'failed'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {paymentBanner.kind === 'success' ? <CheckCircle2 className="w-4 h-4" />
              : paymentBanner.kind === 'failed' ? <AlertTriangle className="w-4 h-4" />
              : <CreditCard className="w-4 h-4" />}
            <span>{paymentBanner.text}</span>
            {paymentBanner.kind === 'pending' && (
              <span className="text-[11px] font-normal opacity-70">
                · Test mode — pay with <code className="font-mono">4111 1111 1111 1111</code>, any future expiry / CVV
              </span>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
                  <Bot className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to {merchantName}</h2>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  I&apos;m an AI commerce agent. I can help you find products, check availability,
                  and complete purchases — all within merchant-defined safety policies.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="text-sm bg-white border border-blue-200 text-slate-700 rounded-full px-4 py-2 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition shadow-xs cursor-pointer"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0 mt-1 shadow-xs">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-3 shadow-xs'
                      : 'bg-white border border-gray-200/80 rounded-2xl rounded-bl-sm px-4 py-3 shadow-xs'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap text-[15px]">{msg.content}</div>
                  ) : (
                    <div className="prose prose-sm max-w-none prose-slate prose-p:leading-relaxed prose-pre:bg-slate-50 prose-pre:text-slate-900 prose-th:border-b prose-th:border-slate-200 prose-th:bg-slate-50 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-slate-100 prose-table:border prose-table:border-slate-200 prose-table:rounded-lg text-[15px] text-slate-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content.replace(/\+\+(.*?)\+\+/g, '**$1**')}
                      </ReactMarkdown>
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-400 mb-2">
                        🔧 {msg.toolCalls.length} tool call{msg.toolCalls.length > 1 ? 's' : ''} executed
                      </p>
                      {msg.toolCalls.map((tc, j) => {
                        const key = `${i}-${j}`;
                        const isExpanded = expandedTools.has(key);
                        return (
                          <div key={j} className="mb-1">
                            <button
                              onClick={() => toggleToolExpand(key)}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 w-full text-left cursor-pointer"
                            >
                              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              <span className="font-mono">{tc.toolName}</span>
                              <span className="text-gray-400 ml-auto">{tc.latencyMs}ms</span>
                            </button>
                            {isExpanded && (
                              <div className="ml-4 mt-1 p-2 bg-gray-50 rounded text-xs font-mono overflow-x-auto">
                                <div className="text-gray-400 mb-1">Input:</div>
                                <pre className="text-gray-700">{JSON.stringify(tc.args, null, 2)}</pre>
                                <div className="text-gray-400 mb-1 mt-2">Output:</div>
                                <pre className="text-gray-700">{JSON.stringify(tc.result, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {msg.traceId && (
                        <Link
                          href={`/merchant/trace?traceId=${msg.traceId}`}
                          className="text-xs text-blue-500 hover:text-blue-600 mt-1 inline-block font-medium"
                        >
                          View full trace →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-1">
                    <User className="w-4 h-4 text-slate-600" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="bg-white border border-gray-200/80 rounded-2xl rounded-bl-sm px-4 py-3 shadow-xs">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="bg-white/95 backdrop-blur-xs border-t border-gray-200 px-4 py-3.5 shadow-md">
          <div className="max-w-3xl mx-auto flex gap-2.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about products, check availability, or make a purchase..."
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm shadow-blue-500/20 cursor-pointer flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
