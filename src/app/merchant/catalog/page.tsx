'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useMerchant } from '@/lib/merchant-context';
import { Search, Package, Box, Plus, Trash2, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react';

type Product = {
  id: string;
  sku: string;
  title: string;
  description?: string;
  category: string;
  price: number;
  stock: number;
  deliveryDays: number;
};

const EMPTY_FORM = {
  title: '',
  category: '',
  description: '',
  price: '',
  stock: '',
  deliveryDays: '',
  sku: '',
};

export default function CatalogPage() {
  const { merchantId } = useMerchant();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant?id=${merchantId}&include=products`);
      if (res.ok) {
        const data = await res.json();
        if (data.merchant?.products) {
          setProducts(data.merchant.products);
        }
      }
    } catch (err) {
      console.error('Failed to fetch catalog:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCatalog();
  }, [fetchCatalog]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))];
    return cats.sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = search === '' ||
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  const totalInStock = products.filter(p => p.stock > 0).length;

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId,
          title: form.title,
          category: form.category,
          description: form.description || undefined,
          price: Number(form.price),
          stock: Number(form.stock),
          deliveryDays: form.deliveryDays ? Number(form.deliveryDays) : undefined,
          sku: form.sku || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to add product.', 'error');
        return;
      }
      showToast(`${data.product.title} added — now agent-readable.`, 'success');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await fetchCatalog();
    } catch {
      showToast('Network error adding product.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    if (!window.confirm(`Remove "${product.title}" from your catalog? Past orders keep their item snapshot.`)) return;
    setDeletingId(product.id);
    try {
      const res = await fetch(`/api/products?id=${product.id}&merchantId=${merchantId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to delete product.', 'error');
        return;
      }
      showToast(`${product.title} removed.`, 'success');
      await fetchCatalog();
    } catch {
      showToast('Network error deleting product.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Product Catalog</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            {products.length} products · {totalInStock} in stock · {categories.length} categories — this is what AI agents can discover and buy
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center space-x-2 bg-[#2B6CB0] hover:bg-blue-700 text-white px-4 py-2 rounded text-[13px] font-bold transition-colors flex-shrink-0"
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          <span>{showForm ? 'Close' : 'Add Product'}</span>
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

      {/* Add Product form */}
      {showForm && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-blue-200">
          <h2 className="text-[15px] font-bold text-gray-900 mb-1">Add a product</h2>
          <p className="text-[12px] text-gray-500 mb-5">
            Descriptions matter: agents read them to match buyer intent. Prices in rupees; stock
            and delivery power the inventory checks.
          </p>
          <form onSubmit={handleAddProduct} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Title *</label>
                <input
                  type="text" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Men's Denim Jacket, water-resistant"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Category *</label>
                <input
                  type="text" value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. jackets (matched by policy rules)"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-bold text-gray-700 mb-1.5">
                Description <span className="text-gray-400 font-normal">(agent-readable — be specific)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Heavy-weight denim jacket with water-resistant finish, 4 pockets, unisex fit."
                rows={2}
                className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Price (₹) *</label>
                <input
                  type="number" min="1" step="0.01" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">Stock *</label>
                <input
                  type="number" min="0" step="1" value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">
                  Delivery (days) <span className="text-gray-400 font-normal">(opt.)</span>
                </label>
                <input
                  type="number" min="1" step="1" value={form.deliveryDays}
                  onChange={(e) => setForm({ ...form, deliveryDays: e.target.value })}
                  placeholder="5"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1.5">
                  SKU <span className="text-gray-400 font-normal">(opt.)</span>
                </label>
                <input
                  type="text" value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="auto"
                  className="w-full p-2.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center space-x-2 bg-[#2B6CB0] hover:bg-blue-700 text-white px-4 py-2 rounded text-[13px] font-bold transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{saving ? 'Adding...' : 'Add to catalog'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filter */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, SKU, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Product</th>
                <th className="px-6 py-3">SKU</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3 text-right">Price (₹)</th>
                <th className="px-6 py-3 text-right">Stock</th>
                <th className="px-6 py-3 text-right">Delivery</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mb-3" />
                      <span className="text-[13px] text-gray-500">Loading catalog...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <Box size={32} className="text-gray-300 mb-3" />
                      <span className="text-[13px] text-gray-500 mb-3">
                        {products.length === 0
                          ? 'No products yet — agents can only buy what you list.'
                          : 'No products match your search.'}
                      </span>
                      {products.length === 0 && (
                        <button
                          onClick={() => setShowForm(true)}
                          className="flex items-center space-x-2 bg-[#2B6CB0] hover:bg-blue-700 text-white px-4 py-2 rounded text-[13px] font-bold transition-colors"
                        >
                          <Plus size={14} />
                          <span>Add your first product</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-blue-50/50 transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                          <Package size={14} className="text-gray-400" />
                        </div>
                        <span className="text-[13px] font-bold text-gray-900">{product.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 font-mono text-[12px] text-gray-500">{product.sku}</td>
                    <td className="px-6 py-3.5">
                      <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {product.category.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right text-[13px] font-bold text-gray-900">
                      ₹{(product.price / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="px-6 py-3.5 text-right text-[13px] text-gray-700">{product.stock}</td>
                    <td className="px-6 py-3.5 text-right text-[13px] text-gray-500">{product.deliveryDays}d</td>
                    <td className="px-6 py-3.5 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        product.stock > 5
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : product.stock > 0
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {product.stock > 5 ? 'In Stock' : product.stock > 0 ? 'Low Stock' : 'Out of Stock'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        onClick={() => handleDeleteProduct(product)}
                        disabled={deletingId === product.id}
                        title="Remove from catalog"
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                      >
                        {deletingId === product.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Footer */}
        {!loading && filteredProducts.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-[12px] text-gray-500">
            Showing {filteredProducts.length} of {products.length} products
          </div>
        )}
      </div>
    </div>
  );
}
