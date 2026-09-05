'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home, Package, Shield, InboxIcon, Activity, ShoppingBag, Plus,
} from 'lucide-react';
import { useMerchant } from '@/lib/merchant-context';

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { merchants, merchantId, setMerchantId } = useMerchant();

  const navLinks = [
    { name: 'Dashboard', href: '/merchant', icon: Home },
    { name: 'Catalog', href: '/merchant/catalog', icon: Package },
    { name: 'Policies', href: '/merchant/policies', icon: Shield },
    { name: 'Approvals', href: '/merchant/approvals', icon: InboxIcon },
    { name: 'Trace', href: '/merchant/trace', icon: Activity },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#F4F5F7] font-sans">
      {/* Top Navigation */}
      <header className="h-14 bg-[#0D121B] text-white flex items-center justify-between px-4 z-50">
        <div className="flex items-center space-x-3">
          <div className="text-xl font-bold tracking-tight flex items-center">
            <span className="text-blue-500 mr-2 text-2xl">⚡</span> Agentic Commerce
          </div>
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-widest border-l border-[#2B3545] pl-3 flex items-center">
            Powered by <span className="italic font-bold ml-1 text-gray-300">Razorpay</span>
          </span>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest border-l border-[#2B3545] pl-3">
            Merchant Console
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <span className="px-2.5 py-1 bg-[#1A2230] border border-[#2B3545] text-[10px] font-bold tracking-widest uppercase text-emerald-400 rounded">
            Test Mode
          </span>
          {/* Store switcher — one gateway, many merchants */}
          <select
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            title="Switch store"
            className="text-[13px] bg-[#1A2230] text-gray-200 border border-[#2B3545] rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer max-w-[180px]"
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id} className="text-gray-900 bg-white">{m.name}</option>
            ))}
          </select>
          <Link
            href="/"
            className="text-[13px] font-medium text-gray-300 hover:text-white flex items-center space-x-1 transition-colors"
          >
            <Plus size={13} />
            <span>New store</span>
          </Link>
          <Link
            href="/buyer"
            className="text-[13px] font-medium text-gray-300 hover:text-white flex items-center space-x-1.5 transition-colors"
          >
            <ShoppingBag size={14} />
            <span>AI Buyer Chat</span>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[220px] bg-white border-r border-gray-200 overflow-y-auto z-10">
          <div className="py-4">
            <div className="px-6 mb-2">
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Agent Products</h3>
            </div>
            <nav className="space-y-0.5">
              {navLinks.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center justify-between px-6 py-2.5 text-[13px] font-medium transition-colors ${
                      isActive
                        ? 'bg-[#F2F5FB] text-blue-700 border-l-4 border-blue-600 pl-5'
                        : 'text-[#4A5568] hover:bg-gray-50 border-l-4 border-transparent pl-5'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <item.icon size={16} className={isActive ? "text-blue-600" : "text-gray-500"} />
                      <span>{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
