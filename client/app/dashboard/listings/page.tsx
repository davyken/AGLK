'use client';

import { useState, useEffect } from 'react';

const API_BASE = 'https://aglk.onrender.com';

interface Listing {
  _id: string;
  type: string;
  product: string;
  status: string;
  price: number | null;
  quantity: number;
  unit: string;
  location: string;
  userPhone: string;
  userName: string;
  createdAt: string;
}

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sell' | 'buy'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetch(`${API_BASE}/listing`)
      .then(res => res.json())
      .then(data => {
        const listingsArr: Listing[] = Array.isArray(data) ? data : (data as any).data || [];
        setListings(listingsArr);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to fetch listings');
        setLoading(false);
      });
  }, []);

  const filteredListings = listings.filter(l => {
    if (filter !== 'all' && l.type !== filter) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    return true;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-900 text-emerald-300';
      case 'matched': return 'bg-blue-900 text-blue-300';
      case 'completed': return 'bg-purple-900 text-purple-300';
      case 'cancelled': return 'bg-red-900 text-red-300';
      default: return 'bg-gray-700 text-gray-300';
    }
  };

  const getTypeColor = (type: string) => {
    return type === 'sell' ? 'bg-emerald-600' : 'bg-amber-600';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading listings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <div className="text-red-400">{error}</div>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8 text-center">Listings</h1>
        
        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
          <div className="flex gap-3">
            <select 
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="sell">Sell</option>
              <option value="buy">Buy</option>
            </select>
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="matched">Matched</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {filteredListings.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No listings found
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800 border-b border-gray-700">
                  <tr>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Type</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Product</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Quantity</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Price</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Location</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Status</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredListings.map((listing) => (
                    <tr key={listing._id} className="hover:bg-gray-800/50">
                      <td className="px-4 sm:px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium text-white ${getTypeColor(listing.type)}`}>
                          {listing.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 font-medium text-white">{listing.product}</td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400">{listing.quantity} {listing.unit}</td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400">
                        {listing.price ? `${listing.price.toLocaleString()} XAF` : '-'}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400">{listing.location || '-'}</td>
                      <td className="px-4 sm:px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(listing.status)}`}>
                          {listing.status}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-gray-500 text-sm">
                        {new Date(listing.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-500">
          Showing {filteredListings.length} of {listings.length} listings
        </div>
      </div>
    </div>
  );
}