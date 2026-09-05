'use client';

import { useEffect, useState, useCallback } from 'react';
import { useMerchant } from '@/lib/merchant-context';
import {
  ShoppingCart, Package, Shield, Activity, AlertTriangle,
  CheckCircle, TrendingUp, ArrowRight, Clock, Bot, Zap
} from 'lucide-react';
import Link from 'next/link';

type ReadinessCheck = {
  dimension: string;
  weight: number;
  score: number;
  passed: boolean;
  detail: string;
  action?: string;
};

type ReadinessData = {
  overall: number;
  checks: ReadinessCheck[];
};

type RecentOrder = {
  id: string;
  status: string;
  total: number;
  createdAt: string;
  buyerIntent: string | null;
  traceId: string;
};

type OrderStats = {
  total: number;
  pending: number;
  confirmed: number;
  failed: number;
  agentOrders: number;
  revenue: number;
  agentRevenue: number;
  avgOrderValue: number;
  agentRevenueShare: number;
  recentOrders: RecentOrder[];
};

export default function MerchantDashboard() {
  const { merchantId, merchantName } = useMerchant();
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [readinessRes, ordersRes] = await Promise.all([
        fetch(`/api/readiness?merchantId=${merchantId}`),
        fetch(`/api/orders?merchantId=${merchantId}`),
      ]);

      if (readinessRes.ok) {
        setReadiness(await readinessRes.json());
      }

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setStats({
          total: data.stats?.total || 0,
          pending: data.stats?.pending || 0,
          confirmed: data.stats?.confirmed || 0,
          failed: (data.stats?.failed || 0) + (data.stats?.cancelled || 0) + (data.stats?.denied || 0),
          agentOrders: data.stats?.agentOrders || 0,
          revenue: data.stats?.revenue || 0,
          agentRevenue: data.stats?.agentRevenue || 0,
          avgOrderValue: data.stats?.avgOrderValue || 0,
          agentRevenueShare: data.stats?.agentRevenueShare || 0,
          recentOrders: data.recentOrders || [],
        });
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboardData();
  }, [fetchDashboardData]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  };

  const getScoreRingColor = (score: number) => {
    if (score >= 80) return '#059669';
    if (score >= 50) return '#D97706';
    return '#DC2626';
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CONFIRMED: 'bg-emerald-100 text-emerald-700',
      PAYMENT_SUCCESS: 'bg-emerald-100 text-emerald-700',
      POLICY_APPROVED: 'bg-blue-100 text-blue-700',
      PAYMENT_PENDING: 'bg-blue-100 text-blue-700',
      PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
      PAYMENT_UNKNOWN: 'bg-amber-100 text-amber-700',
      POLICY_DENIED: 'bg-red-100 text-red-700',
      PAYMENT_FAILED: 'bg-red-100 text-red-700',
      QUOTED: 'bg-gray-100 text-gray-700',
      CANCELLED: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <div className="animate-pulse grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-40 bg-gray-100 rounded-lg"></div>
          <div className="h-40 bg-gray-100 rounded-lg"></div>
          <div className="h-40 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  const overallScore = readiness?.overall ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Welcome to {merchantName}</h1>
        <p className="text-[13px] text-gray-500 mt-1">
          Your agentic commerce control plane — monitor AI agent readiness, transactions, and policies.
        </p>
      </div>

      {/* Revenue growth — the agentic channel's contribution, attributed */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900">Revenue growth</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Collected revenue (CONFIRMED orders), split by channel — so you can see what the AI
              channel added.
            </p>
          </div>
          <TrendingUp size={16} className="text-emerald-600" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          <div className="px-6 py-4">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Total revenue</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ₹{(stats?.revenue || 0).toLocaleString('en-IN')}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">{stats?.confirmed || 0} paid orders</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              From AI agents
            </p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              ₹{(stats?.agentRevenue || 0).toLocaleString('en-IN')}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">New channel, no site traffic needed</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Agent share
            </p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{stats?.agentRevenueShare || 0}%</p>
            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(stats?.agentRevenueShare || 0, 100)}%` }}
              />
            </div>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Avg order value
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ₹{(stats?.avgOrderValue || 0).toLocaleString('en-IN')}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">Across paid orders</p>
          </div>
        </div>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Readiness Score */}
        <div className={`p-5 rounded-lg border ${getScoreBg(overallScore)}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">AI Readiness</p>
              <p className={`text-3xl font-bold mt-1 ${getScoreColor(overallScore)}`}>{overallScore}%</p>
            </div>
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke="#E5E7EB" strokeWidth="4" />
                <circle
                  cx="28" cy="28" r="24" fill="none"
                  stroke={getScoreRingColor(overallScore)}
                  strokeWidth="4"
                  strokeDasharray={`${(overallScore / 100) * 150.8} 150.8`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <TrendingUp size={16} className={getScoreColor(overallScore)} />
              </div>
            </div>
          </div>
        </div>

        {/* Total Orders */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Total Orders</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{stats?.total || 0}</p>
          <div className="flex items-center space-x-1 mt-1">
            <ShoppingCart size={12} className="text-gray-400" />
            <span className="text-[11px] text-gray-400">Lifetime</span>
          </div>
        </div>

        {/* Pending Approvals */}
        <Link href="/merchant/approvals" className="block">
          <div className={`p-5 rounded-lg border shadow-sm transition-colors hover:border-amber-300 ${
            (stats?.pending || 0) > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'
          }`}>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Pending Approvals</p>
            <p className={`text-3xl font-bold mt-1 ${(stats?.pending || 0) > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
              {stats?.pending || 0}
            </p>
            <div className="flex items-center space-x-1 mt-1">
              <Clock size={12} className="text-gray-400" />
              <span className="text-[11px] text-gray-400">Needs review</span>
            </div>
          </div>
        </Link>

        {/* Orders from AI agents */}
        <div className="bg-white p-5 rounded-lg border border-blue-200 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">AI Agent Orders</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{stats?.agentOrders || 0}</p>
          <div className="flex items-center space-x-1 mt-1">
            <Bot size={12} className="text-gray-400" />
            <span className="text-[11px] text-gray-400">Via MCP (e.g. Claude)</span>
          </div>
        </div>

        {/* Confirmed */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Confirmed</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{stats?.confirmed || 0}</p>
          <div className="flex items-center space-x-1 mt-1">
            <CheckCircle size={12} className="text-gray-400" />
            <span className="text-[11px] text-gray-400">Paid &amp; fulfilled</span>
          </div>
        </div>
      </div>

      {/* Go live: the merchant's agent endpoint */}
      <div className="bg-[#0D121B] text-white rounded-lg shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <Zap size={18} className="text-blue-400" />
              <h2 className="text-[15px] font-bold">Go live for AI buyers</h2>
            </div>
            <p className="text-[12px] text-gray-400 leading-relaxed">
              Your governed MCP endpoint serves this store&apos;s catalog and policies to any
              MCP-connected agent. Orders they place appear in Recent Orders and the{' '}
              <Link href="/merchant/trace" className="text-blue-400 hover:text-blue-300 font-medium">
                execution trace
              </Link>{' '}
              with every tool call, policy decision, and payment event.
            </p>
          </div>
          <div className="lg:w-[380px] flex-shrink-0 space-y-3">
            <div className="bg-[#1A2230] border border-[#2B3545] rounded p-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">MCP endpoint</p>
              <div className="flex items-center justify-between gap-2">
                <code className="text-[12px] font-mono text-emerald-400 truncate">
                  /api/mcp?merchantId={merchantId}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/api/mcp?merchantId=${merchantId}`)}
                  className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex-shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="bg-[#1A2230] border border-[#2B3545] rounded p-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Buyer adds to Claude Desktop
              </p>
              <pre className="text-[10px] font-mono text-gray-300 overflow-x-auto">
{`{ "mcpServers": {
    "acg": { "command": "npx",
      "args": ["mcp-remote",
        "<origin>/api/mcp?merchantId=${merchantId}"] } } }`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-bold text-gray-900">Recent Orders</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Latest agent-driven transactions — click to inspect the trace</p>
        </div>
        {(!stats || stats.recentOrders.length === 0) ? (
          <div className="px-6 py-10 text-center text-[13px] text-gray-400">
            No orders yet. Start a buyer conversation from the AI chat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-2.5">Order</th>
                  <th className="px-6 py-2.5">Intent</th>
                  <th className="px-6 py-2.5">Status</th>
                  <th className="px-6 py-2.5 text-right">Total</th>
                  <th className="px-6 py-2.5 text-right">When</th>
                  <th className="px-6 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stats.recentOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-[11px] text-gray-500">{o.id.slice(0, 10)}…</td>
                    <td className="px-6 py-3 text-gray-700 max-w-[220px] truncate">{o.buyerIntent || '—'}</td>
                    <td className="px-6 py-3">{getStatusBadge(o.status)}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-800">₹{o.total.toLocaleString('en-IN')}</td>
                    <td className="px-6 py-3 text-right text-gray-400 text-[11px]">
                      {new Date(o.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link href={`/merchant/trace?traceId=${o.traceId}`} className="text-blue-600 hover:text-blue-700 font-medium text-[12px]">
                        Trace →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Readiness Checks + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Readiness Breakdown */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-[15px] font-bold text-gray-900">Readiness Checklist</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Ensure your store is fully configured for AI-powered commerce</p>
          </div>
          <div className="divide-y divide-gray-100">
            {readiness?.checks.map((check, idx) => (
              <div key={idx} className="px-6 py-4 flex items-start space-x-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  check.passed ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'
                }`}>
                  {check.passed 
                    ? <CheckCircle size={16} className="text-emerald-600" /> 
                    : <AlertTriangle size={16} className="text-amber-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-gray-900">{check.dimension}</span>
                    <span className={`text-[13px] font-bold ${check.passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {check.score}%
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 mt-0.5">{check.detail}</p>
                  {check.action && (
                    <p className="text-[11px] text-blue-600 mt-1 font-medium">→ {check.action}</p>
                  )}
                  {/* Progress bar */}
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        check.passed ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${check.score}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-[15px] font-bold text-gray-900">Quick Actions</h2>
            </div>
            <div className="divide-y divide-gray-100">
              <Link href="/buyer" className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-blue-50 border border-blue-200 flex items-center justify-center group-hover:bg-blue-100">
                    <ShoppingCart size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <span className="text-[13px] font-bold text-gray-900">AI Chat</span>
                    <p className="text-[11px] text-gray-500">Start a buyer conversation</p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" />
              </Link>

              <Link href="/merchant/catalog" className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-purple-50 border border-purple-200 flex items-center justify-center group-hover:bg-purple-100">
                    <Package size={14} className="text-purple-600" />
                  </div>
                  <div>
                    <span className="text-[13px] font-bold text-gray-900">Product Catalog</span>
                    <p className="text-[11px] text-gray-500">Browse inventory</p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" />
              </Link>

              <Link href="/merchant/policies" className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-amber-50 border border-amber-200 flex items-center justify-center group-hover:bg-amber-100">
                    <Shield size={14} className="text-amber-600" />
                  </div>
                  <div>
                    <span className="text-[13px] font-bold text-gray-900">Policies</span>
                    <p className="text-[11px] text-gray-500">Configure guardrails</p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" />
              </Link>

              <Link href="/merchant/trace" className="flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-emerald-50 border border-emerald-200 flex items-center justify-center group-hover:bg-emerald-100">
                    <Activity size={14} className="text-emerald-600" />
                  </div>
                  <div>
                    <span className="text-[13px] font-bold text-gray-900">Execution Trace</span>
                    <p className="text-[11px] text-gray-500">View audit logs</p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500" />
              </Link>
            </div>
          </div>

          {/* How It Works */}
          <div className="bg-[#0D121B] text-white rounded-lg p-5 shadow-sm">
            <h3 className="text-[13px] font-bold mb-3">How Agentic Commerce Works</h3>
            <div className="space-y-3">
              {[
                { step: '1', label: 'Buyer chats with AI', desc: 'Natural language product discovery' },
                { step: '2', label: 'Agent calls tools', desc: 'search_products, check_inventory, quote_order' },
                { step: '3', label: 'Policy engine checks', desc: 'Spending limits, category restrictions' },
                { step: '4', label: 'Payment via Razorpay', desc: 'Secure test mode payment' },
                { step: '5', label: 'Full trace logged', desc: 'Every step is auditable' },
              ].map((item) => (
                <div key={item.step} className="flex items-start space-x-3">
                  <span className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                    {item.step}
                  </span>
                  <div>
                    <p className="text-[12px] font-bold text-white">{item.label}</p>
                    <p className="text-[11px] text-gray-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
