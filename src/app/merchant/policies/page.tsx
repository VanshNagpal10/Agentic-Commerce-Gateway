'use client';

import { useEffect, useState, useCallback } from 'react';
import { useMerchant } from '@/lib/merchant-context';
import { Save, AlertTriangle, CheckCircle, Shield } from 'lucide-react';

export default function PoliciesPage() {
  const { merchantId } = useMerchant();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success'|'error'} | null>(null);

  // Form stores values in RUPEES for display. API expects RUPEES and converts to paise.
  const [form, setForm] = useState({
    maxAutoSpendRupees: 5000,
    approvalThresholdRupees: 10000,
    maxDiscountPct: 15,
    restrictedCategories: 'gift_cards',
    minStock: 2,
    maxRetries: 1
  });

  const [previewAmount, setPreviewAmount] = useState(7500);
  const [previewCategory, setPreviewCategory] = useState('');
  const [previewRes, setPreviewRes] = useState<'ALLOW' | 'APPROVAL_REQUIRED' | 'DENY'>('ALLOW');
  const [previewReason, setPreviewReason] = useState('');

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/policies?merchantId=${merchantId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.policy) {
          // API returns raw paise values + computed rupees values
          const cats = data.policy.restrictedCategories;
          let catsStr = '';
          if (Array.isArray(cats)) {
            catsStr = cats.join(', ');
          } else if (typeof cats === 'string') {
            catsStr = cats;
          }

          setForm({
            maxAutoSpendRupees: data.policy.maxAutoSpendRupees || data.policy.maxAutoSpend / 100,
            approvalThresholdRupees: data.policy.approvalThresholdRupees || data.policy.approvalThreshold / 100,
            maxDiscountPct: data.policy.maxDiscountPct ?? 15,
            restrictedCategories: catsStr,
            minStock: data.policy.minStock ?? 2,
            maxRetries: data.policy.maxRetries ?? 1,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPolicies();
  }, [fetchPolicies]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convert restricted categories string to array
      const catsArray = form.restrictedCategories
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/merchant/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId,
          maxAutoSpend: form.maxAutoSpendRupees,       // API multiplies by 100
          approvalThreshold: form.approvalThresholdRupees, // API multiplies by 100
          maxDiscountPct: form.maxDiscountPct,
          restrictedCategories: catsArray,
          minStock: form.minStock,
          maxRetries: form.maxRetries,
        })
      });
      if (res.ok) {
        setToast({ msg: 'Policies saved successfully!', type: 'success' });
      } else {
        const data = await res.json();
        setToast({ msg: data.error || 'Failed to save policies.', type: 'error' });
      }
    } catch {
      setToast({ msg: 'Network error saving policies.', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Live preview calls the SAME deterministic engine as production.
  // Note: reflects the last SAVED policy, so save before testing edited limits.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/policies/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchantId, amount: previewAmount, category: previewCategory || undefined }),
        });
        if (res.ok) {
          const data = await res.json();
          setPreviewRes(data.decision?.decision || 'ALLOW');
          setPreviewReason((data.decision?.reasons || []).join('; '));
        }
      } catch {
        // non-fatal
      }
    }, 300);
    return () => clearTimeout(t);
  }, [merchantId, previewAmount, previewCategory]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-gray-900">Agentic Policies</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-100 rounded-lg"></div>
          <div className="h-48 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agentic Policies</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Define guardrails for AI agent behavior — spending limits, approval thresholds, and category restrictions
          </p>
        </div>
        <button 
          onClick={handleSave} 
          disabled={saving}
          className="flex items-center space-x-2 bg-[#2B6CB0] hover:bg-blue-700 text-white px-4 py-2 rounded text-[13px] font-bold transition-colors disabled:opacity-50"
        >
          <Save size={14} />
          <span>{saving ? 'Saving...' : 'Save Policies'}</span>
        </button>
      </div>

      {toast && (
        <div className={`p-3 rounded-lg text-[13px] font-medium flex items-center space-x-2 ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Financial Guardrails */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center space-x-2 mb-5">
              <Shield size={18} className="text-blue-600" />
              <h2 className="text-[15px] font-bold text-gray-900">Financial Guardrails</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Max Auto Spend (₹)</label>
                <input 
                  type="number" 
                  value={form.maxAutoSpendRupees} 
                  onChange={(e) => setForm({...form, maxAutoSpendRupees: Number(e.target.value)})}
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
                <p className="text-[11px] text-gray-500 mt-1">Agent can auto-approve orders up to this amount.</p>
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Approval Threshold (₹)</label>
                <input 
                  type="number" 
                  value={form.approvalThresholdRupees} 
                  onChange={(e) => setForm({...form, approvalThresholdRupees: Number(e.target.value)})}
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
                <p className="text-[11px] text-gray-500 mt-1">Orders above auto-spend but below this go to Approvals. Above this = denied.</p>
              </div>
            </div>
          </div>

          {/* Operational Limits */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-[15px] font-bold text-gray-900 mb-5">Operational Limits</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Max Discount (%)</label>
                <input 
                  type="number" 
                  value={form.maxDiscountPct} 
                  onChange={(e) => setForm({...form, maxDiscountPct: Number(e.target.value)})}
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Min Stock Buffer</label>
                <input 
                  type="number" 
                  value={form.minStock} 
                  onChange={(e) => setForm({...form, minStock: Number(e.target.value)})}
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Max Payment Retries</label>
                <input 
                  type="number" 
                  value={form.maxRetries} 
                  onChange={(e) => setForm({...form, maxRetries: Number(e.target.value)})}
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Restricted Categories</label>
                <input 
                  type="text" 
                  value={form.restrictedCategories} 
                  onChange={(e) => setForm({...form, restrictedCategories: e.target.value})}
                  placeholder="gift_cards, high_value_electronics"
                  className="w-full p-2.5 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 outline-none text-[13px]"
                />
                <p className="text-[11px] text-gray-500 mt-1">Comma-separated. Agent cannot purchase from these categories.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="lg:col-span-1">
          <div className="bg-[#0D121B] text-white p-6 rounded-lg shadow-sm sticky top-4">
            <div className="flex items-center space-x-2 mb-4">
              <AlertTriangle className="text-amber-400" size={18} />
              <h2 className="text-[15px] font-bold">Live Policy Preview</h2>
            </div>
            
            <div className="mb-4">
              <label className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Test Amount (₹)</label>
              <input
                type="number"
                value={previewAmount}
                onChange={(e) => setPreviewAmount(Number(e.target.value))}
                className="w-full mt-1 p-2 bg-[#1A2230] border border-[#2B3545] rounded text-white text-[13px] focus:border-blue-500 outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Category (optional)</label>
              <input
                type="text"
                value={previewCategory}
                onChange={(e) => setPreviewCategory(e.target.value)}
                placeholder="e.g. gift_cards"
                className="w-full mt-1 p-2 bg-[#1A2230] border border-[#2B3545] rounded text-white text-[13px] focus:border-blue-500 outline-none"
              />
            </div>

            <div className="bg-[#1A2230] p-3 rounded text-[12px] font-mono text-gray-400 mb-4">
              Agent attempts purchase of ₹{previewAmount.toLocaleString('en-IN')}
              {previewCategory ? ` in "${previewCategory}"` : ''}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Decision (live engine)</p>
              <div className={`text-lg font-bold p-3 rounded flex items-center justify-center border ${
                previewRes === 'ALLOW' ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' :
                previewRes === 'APPROVAL_REQUIRED' ? 'bg-amber-900/30 border-amber-500/50 text-amber-400' :
                'bg-red-900/30 border-red-500/50 text-red-400'
              }`}>
                {previewRes === 'ALLOW' ? '✅ ALLOW' : previewRes === 'APPROVAL_REQUIRED' ? '⏳ NEEDS APPROVAL' : '🚫 DENY'}
              </div>
              {previewReason && (
                <p className="text-[11px] text-gray-400 italic">{previewReason}</p>
              )}
              <p className="text-[10px] text-gray-500">Reflects the last saved policy — save changes to test new limits.</p>
            </div>

            <div className="mt-4 space-y-1.5 text-[11px] text-gray-400 border-t border-[#2B3545] pt-4">
              <p className="font-bold text-gray-300 mb-2">Current Policy Summary</p>
              <p>• Auto-approve: up to ₹{form.maxAutoSpendRupees.toLocaleString('en-IN')}</p>
              <p>• Needs approval: ₹{form.maxAutoSpendRupees.toLocaleString('en-IN')} – ₹{form.approvalThresholdRupees.toLocaleString('en-IN')}</p>
              <p>• Denied: above ₹{form.approvalThresholdRupees.toLocaleString('en-IN')}</p>
              <p>• Max discount: {form.maxDiscountPct}%</p>
              <p>• Restricted: {form.restrictedCategories || 'none'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
