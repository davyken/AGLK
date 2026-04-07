'use client';

import { useState, useEffect } from 'react';

const API_BASE = 'https://aglk.onrender.com';

interface Listing {
  _id: string;
  userPhone: string;
  userName: string;
  userLocation: string;
  type: string;
  product: string;
  quantity: number;
  unit: string;
  marketMinPrice: number | null;
  marketAvgPrice: number | null;
  marketMaxPrice: number | null;
  suggestedPrice: number | null;
  price: number | null;
  priceType: string;
  acceptedSuggestion: boolean;
  status: string;
  location: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
}

const hiddenFields = ['userPhone', 'price', 'location'];

function fetchWithTimeout(promise: Promise<Response>, timeout = 10000): Promise<Response> {
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['userPhone', 'price']));
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [formData, setFormData] = useState({ status: '', price: 0, product: '', quantity: 0, unit: '' });
  const [saving, setSaving] = useState(false);

  const fetchListings = () => {
    setLoading(true);
    setError(null);
    
    fetchWithTimeout(fetch(`${API_BASE}/listing`))
      .then(res => res.json())
      .then(data => {
        setListings(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        setError('Server may be starting up (can take ~30s)');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchListings();
  }, []);

  const toggleColumn = (field: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const openEditModal = (listing: Listing) => {
    setEditingListing(listing);
    setFormData({
      status: listing.status || '',
      price: listing.price || 0,
      product: listing.product || '',
      quantity: listing.quantity || 0,
      unit: listing.unit || '',
    });
  };

  const closeModal = () => {
    setEditingListing(null);
    setFormData({ status: '', price: 0, product: '', quantity: 0, unit: '' });
  };

  const handleSave = async () => {
    if (!editingListing) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/listing/${editingListing._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      fetchListings();
      closeModal();
    } catch (err) {
      alert('Failed to update listing');
    }
    setSaving(false);
  };

  const updateStatus = async (listing: Listing, newStatus: string) => {
    try {
      await fetch(`${API_BASE}/listing/${listing._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchListings();
    } catch (err) {
      alert('Failed to update status');
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const columns: { key: keyof Listing; label: string; visible: boolean }[] = [
    { key: 'userPhone', label: 'User Phone', visible: !hiddenColumns.has('userPhone') },
    { key: 'userName', label: 'User Name', visible: true },
    { key: 'userLocation', label: 'User Location', visible: true },
    { key: 'type', label: 'Type', visible: true },
    { key: 'product', label: 'Product', visible: true },
    { key: 'quantity', label: 'Quantity', visible: true },
    { key: 'unit', label: 'Unit', visible: true },
    { key: 'marketMinPrice', label: 'Min Price', visible: true },
    { key: 'marketAvgPrice', label: 'Avg Price', visible: true },
    { key: 'marketMaxPrice', label: 'Max Price', visible: true },
    { key: 'suggestedPrice', label: 'Suggested Price', visible: true },
    { key: 'price', label: 'Price', visible: !hiddenColumns.has('price') },
    { key: 'priceType', label: 'Price Type', visible: true },
    { key: 'acceptedSuggestion', label: 'Accepted', visible: true },
    { key: 'status', label: 'Status', visible: true },
    { key: 'location', label: 'Location', visible: true },
    { key: 'channel', label: 'Channel', visible: true },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 animate-pulse">Loading listings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-red-500">{error}</div>
        <button 
          onClick={fetchListings}
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Listings</h1>
        <div className="flex gap-2">
          <button 
            onClick={fetchListings}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm"
          >
            🔄 Refresh
          </button>
          {hiddenFields.map(field => (
            <button
              key={field}
              onClick={() => toggleColumn(field)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                hiddenColumns.has(field)
                  ? 'bg-gray-200 text-gray-600'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              <span>{hiddenColumns.has(field) ? '👁' : '🔒'}</span>
              {field === 'userPhone' ? 'Phone' : field === 'price' ? 'Price' : field}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full min-w-[1200px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.filter(col => col.visible).map(col => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listings.map(listing => (
              <tr key={listing._id} className="hover:bg-gray-50">
                {columns.filter(col => col.visible).map(col => (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap"
                  >
                    {formatValue(listing[col.key])}
                  </td>
                ))}
                <td className="px-4 py-3 flex gap-2">
                  <button 
                    onClick={() => openEditModal(listing)} 
                    className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                    title="Edit listing"
                  >
                    ⚙️
                  </button>
                  <select
                    value={listing.status}
                    onChange={e => updateStatus(listing, e.target.value)}
                    className="text-sm border rounded px-2 py-1 bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="matched">Matched</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </td>
              </tr>
            ))}
            {listings.length === 0 && (
              <tr>
                <td colSpan={columns.filter(c => c.visible).length + 1} className="px-4 py-8 text-center text-gray-500">
                  No listings found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingListing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold mb-4">Edit Listing</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                <input
                  type="text"
                  value={formData.product}
                  onChange={e => setFormData({ ...formData, product: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <input
                  type="text"
                  value={formData.unit}
                  onChange={e => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="active">Active</option>
                  <option value="matched">Matched</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}