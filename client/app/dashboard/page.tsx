'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell
} from 'recharts';

const API_BASE = 'https://aglk.onrender.com';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

function fetchWithTimeout(promise: Promise<Response>, timeout = 10000): Promise<Response> {
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

interface Listing {
  _id: string;
  type: string;
  product: string;
  status: string;
  price: number | null;
  quantity: number;
  createdAt: string;
}

interface User {
  _id: string;
  phone: string;
  name: string;
  role: string;
  location: string;
}

interface Stats {
  totalListings: number;
  totalUsers: number;
  activeListings: number;
  matchedListings: number;
  completedListings: number;
  farmers: number;
  buyers: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalListings: 0,
    totalUsers: 0,
    activeListings: 0,
    matchedListings: 0,
    completedListings: 0,
    farmers: 0,
    buyers: 0,
  });
  const [listings, setListings] = useState<Listing[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    Promise.all([
      fetchWithTimeout(fetch(`${API_BASE}/listing`, { signal: controller.signal })),
      fetchWithTimeout(fetch(`${API_BASE}/users`, { signal: controller.signal })),
    ])
      .then(([listingRes, usersRes]) => Promise.all([listingRes.json(), usersRes.json()]))
      .then(([listingData, usersData]) => {
        const listings = Array.isArray(listingData) ? listingData : listingData.data || [];
        const users = Array.isArray(usersData) ? usersData : usersData.data || [];
        
        setListings(listings);
        setUsers(users);

        const farmers = users.filter((u: User) => u.role === 'farmer').length;
        const buyers = users.filter((u: User) => u.role === 'buyer').length;

        setStats({
          totalListings: listings.length,
          totalUsers: users.length,
          activeListings: listings.filter((l: Listing) => l.status === 'active').length,
          matchedListings: listings.filter((l: Listing) => l.status === 'matched').length,
          completedListings: listings.filter((l: Listing) => l.status === 'completed').length,
          farmers,
          buyers,
        });
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to fetch data');
        setLoading(false);
      });

    return () => clearTimeout(timeoutId);
  }, []);

  const productData = Object.entries(
    listings.reduce((acc: Record<string, number>, l) => {
      const product = l.product?.replace(/[^a-zA-Z]/g, '') || 'Unknown';
      acc[product] = (acc[product] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const roleData = [
    { name: 'Farmers', value: stats.farmers },
    { name: 'Buyers', value: stats.buyers },
  ];

  const statusData = [
    { name: 'Active', value: stats.activeListings },
    { name: 'Matched', value: stats.matchedListings },
    { name: 'Completed', value: stats.completedListings },
  ];

  const typeData = [
    { name: 'Sell', value: listings.filter(l => l.type === 'sell').length },
    { name: 'Buy', value: listings.filter(l => l.type === 'buy').length },
  ];

  const priceRanges = [
    { range: '0-10k', min: 0, max: 10000 },
    { range: '10k-25k', min: 10000, max: 25000 },
    { range: '25k-50k', min: 25000, max: 50000 },
    { range: '50k+', min: 50000, max: Infinity },
  ];
  const priceData = priceRanges.map(r => ({
    range: r.range,
    count: listings.filter(l => l.price && l.price >= r.min && l.price < r.max).length,
  }));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
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
        <h1 className="text-3xl font-bold text-white mb-8 text-center">Dashboard</h1>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-800 p-4 md:p-6 rounded-xl">
            <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">Total Listings</h3>
            <p className="text-2xl md:text-3xl font-bold text-emerald-400">{stats.totalListings}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 p-4 md:p-6 rounded-xl">
            <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">Total Users</h3>
            <p className="text-2xl md:text-3xl font-bold text-blue-400">{stats.totalUsers}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 p-4 md:p-6 rounded-xl">
            <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">Active</h3>
            <p className="text-2xl md:text-3xl font-bold text-amber-400">{stats.activeListings}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 p-4 md:p-6 rounded-xl">
            <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">Farmers / Buyers</h3>
            <p className="text-2xl md:text-3xl font-bold text-purple-400">{stats.farmers} / {stats.buyers}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Listings by Product</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={productData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Users by Role</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={roleData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                >
                  {roleData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Listings by Status</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Listings by Type</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={typeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                >
                  {typeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Price Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="range" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-4">Users by Location</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart 
                data={Object.entries(
                  users.reduce((acc: Record<string, number>, u) => {
                    const loc = u.location || 'Unknown';
                    acc[loc] = (acc[loc] || 0) + 1;
                    return acc;
                  }, {})
                ).slice(0, 10).map(([name, value]) => ({ name, value }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-45} textAnchor="end" />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}