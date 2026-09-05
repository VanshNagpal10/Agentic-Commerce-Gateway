'use client';

import { useEffect, useState, useCallback } from 'react';
import { useMerchant } from '@/lib/merchant-context';
import { Check, X, RefreshCcw, Clock, ShieldAlert, AlertCircle } from 'lucide-react';
import Link from 'next/link';

type OrderItem = {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
};

type Approval = {
  id: string;
  status: string;
  buyerIntent: string | null;
  items: OrderItem[];
  total: number;
  totalRupees: number;
  traceId: string;
  policyReason: string;
  createdAt: string;
};

export default function ApprovalsPage() {
  const { merchantId } = useMerchant();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals?merchantId=${merchantId}`);
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals || []);
      }
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApprovals();
  }, [fetchApprovals]);

  const handleAction = async (orderId: string, decision: 'approve' | 'deny') => {
    setActionLoading(orderId);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId, orderId, decision }),
      });
      if (res.ok) {
        setToast({
          msg: decision === 'approve' ? 'Order approved successfully!' : 'Order denied.',
          type: decision === 'approve' ? 'success' : 'error',
        });
        await fetchApprovals();
      } else {
        const data = await res.json();
        setToast({ msg: data.error || 'Action failed', type: 'error' });
      }
    } catch (err) {
      console.error('Failed to process approval:', err);
      setToast({ msg: 'Network error. Please try again.', type: 'error' });
    } finally {
      setActionLoading(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Orders that exceed your auto-spend limit need manual review
          </p>
        </div>
        <button
          onClick={fetchApprovals}
          className="flex items-center space-x-2 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
        >
          <RefreshCcw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {toast && (
        <div className={`p-3 rounded-lg text-[13px] font-medium ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-28 bg-gray-100 rounded-lg"></div>
          <div className="h-28 bg-gray-100 rounded-lg"></div>
        </div>
      ) : approvals.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4 border border-emerald-100">
            <Check className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-base font-bold text-gray-900">All caught up!</h3>
          <p className="text-[13px] text-gray-500 mt-1 max-w-sm">
            No orders pending your approval. Orders exceeding the auto-spend threshold will appear here for review.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((app) => {
            const items = Array.isArray(app.items) ? app.items : [];
            const isProcessing = actionLoading === app.id;

            return (
              <div key={app.id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-amber-50 rounded-full flex items-center justify-center border border-amber-200">
                      <ShieldAlert size={16} className="text-amber-600" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[13px] font-bold text-gray-900">Order {app.id.substring(0, 12)}...</span>
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">
                          PENDING APPROVAL
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 mt-0.5">
                        <Clock size={12} className="text-gray-400" />
                        <span className="text-[11px] text-gray-400">
                          {new Date(app.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-gray-900">
                    ₹{(app.totalRupees || app.total / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Body */}
                <div className="px-6 py-4">
                  {app.buyerIntent && (
                    <div className="mb-3">
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Buyer Intent</span>
                      <p className="text-[13px] text-gray-700 mt-0.5">&quot;{app.buyerIntent}&quot;</p>
                    </div>
                  )}

                  {/* Items */}
                  {items.length > 0 && (
                    <div className="mb-3">
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Items</span>
                      <div className="mt-1 space-y-1">
                        {items.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[13px]">
                            <span className="text-gray-700">{item.title} × {item.quantity}</span>
                            <span className="text-gray-500 font-mono">₹{(item.unitPrice / 100).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Policy Reason */}
                  <div className="flex items-start space-x-2 bg-red-50 border border-red-100 rounded p-3 mt-3">
                    <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-[11px] font-bold text-red-600 uppercase">Policy Flag</span>
                      <p className="text-[12px] text-red-700 mt-0.5">{app.policyReason}</p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                  <Link
                    href={`/merchant/trace?traceId=${app.traceId}`}
                    className="text-[12px] text-blue-600 font-medium hover:underline"
                  >
                    View full trace →
                  </Link>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => handleAction(app.id, 'deny')}
                      disabled={isProcessing}
                      className="flex items-center space-x-1.5 px-4 py-2 border border-red-200 text-red-600 bg-white hover:bg-red-50 rounded text-[13px] font-bold transition-colors disabled:opacity-50"
                    >
                      <X size={14} />
                      <span>Deny</span>
                    </button>
                    <button
                      onClick={() => handleAction(app.id, 'approve')}
                      disabled={isProcessing}
                      className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[13px] font-bold transition-colors disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
