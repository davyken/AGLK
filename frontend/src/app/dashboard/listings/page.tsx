'use client';

import { useState, useEffect } from 'react';

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

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['userPhone', 'price']));

  useEffect(() => {
    fetch('https://aglk.onrender.com/listing')
      .then(res => res.json())
      .then(data => {
        setListings(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to fetch listings');
        setLoading(false);
      });
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
        <div className="text-gray-500">Loading listings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Listings</h1>
        <div className="flex gap-2">
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
                <td className="px-4 py-3">
                  <button className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
                    📝
                  </button>
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
    </div>
  );
}