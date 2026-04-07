'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area 
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
  role: string;
  location: string;
  trustScore: number;
  conversationState: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ 
    totalListings: 0, totalUsers: 0, activeListings: 0,
    farmers: 0, buyers: 0, matchedListings: 0, completedListings: 0 
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    Promise.all([
      fetchWithTimeout(fetch(`${API_BASE}/listing`, { signal: controller.signal })),
      fetchWithTimeout(fetch(`${API_BASE}/users`, { signal: controller.signal })),
    ])
      .then(([listingsRes, usersRes]) => Promise.all([listingsRes.json(), usersRes.json()]))
      .then(([listingsData, usersData]) => {
        clearTimeout(timeoutId);
        const listingsArr: Listing[] = Array.isArray(listingsData) ? listingsData : listingsData.data || [];
        const usersArr: User[] = Array.isArray(usersData) ? usersData : usersData.data || [];
        
        setListings(listingsArr);
        setUsers(usersArr);

        const activeListings = listingsArr.filter(l => l.status === 'active').length;
        const matchedListings = listingsArr.filter(l => l.status === 'matched').length;
        const completedListings = listingsArr.filter(l => l.status === 'completed').length;
        const farmers = usersArr.filter(u => u.role === 'farmer').length;
        const buyers = usersArr.filter(u => u.role === 'buyer').length;

        setStats({
          totalListings: listingsArr.length,
          totalUsers: usersArr.length,
          activeListings,
          matchedListings,
          completedListings,
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

  // Chart data: Listings by product
  const productData = listings.reduce((acc: Record<string, number>, l) => {
    const product = l.product || 'Unknown';
    acc[product] = (acc[product] || 0) + 1;
    return acc;
  }, {});

  const productChartData = Object.entries(productData).map(([name, value]) => ({ name, value }));

  // Chart data: Users by role
  const roleData = [
    { name: 'Farmers', value: stats.farmers },
    { name: 'Buyers', value: stats.buyers },
  ];

  // Chart data: Listings by status
  const statusData = [
    { name: 'Active', value: stats.activeListings },
    { name: 'Matched', value: stats.matchedListings },
    { name: 'Completed', value: stats.completedListings },
    { name: 'Cancelled', value: listings.filter(l => l.status === 'cancelled').length },
  ];

  // Chart data: Listings by type (sell/buy)
  const typeData = [
    { name: 'Sell', value: listings.filter(l => l.type === 'sell').length },
    { name: 'Buy', value: listings.filter(l => l.type === 'buy').length },
  ];

  // Chart data: Listings by location
  const locationData = listings.reduce((acc: Record<string, number>, l) => {
    const loc = l.status || 'Unknown';
    acc[loc] = (acc[loc] || 0) + 1;
    return acc;
  }, {});

  const locationChartData = Object.entries(locationData).map(([name, value]) => ({ name, value }));

  // Chart data: Price distribution
  const priceRanges = [
    { range: '0-500', min: 0, max: 500 },
    { range: '501-1000', min: 501, max: 1000 },
    { range: '1001-2000', min: 1001, max: 2000 },
    { range: '2000+', min: 2001, max: Infinity },
  ];

  const priceData = priceRanges.map(r => ({
    range: r.range,
    count: listings.filter(l => l.price && l.price >= r.min && l.price <= r.max).length,
  }));

  // Chart data: Users by location
  const userLocationData = users.reduce((acc: Record<string, number>, u) => {
    const loc = u.location || 'Unknown';
    acc[loc] = (acc[loc] || 0) + 1;
    return acc;
  }, {});

  const userLocationChartData = Object.entries(userLocationData).map(([name, value]) => ({ name, value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-red-500">{error}</div>
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
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>
      
      {/* Stats Cards */}
      <div className="grid md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Listings</h3>
          <p className="text-3xl font-bold text-emerald-600">{stats.totalListings}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Users</h3>
          <p className="text-3xl font-bold text-blue-600">{stats.totalUsers}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Active Listings</h3>
          <p className="text-3xl font-bold text-amber-600">{stats.activeListings}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Farmers / Buyers</h3>
          <p className="text-3xl font-bold text-purple-600">{stats.farmers} / {stats.buyers}</p>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Listings by Product - Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Listings by Product</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={productChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Users by Role - Pie Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Users by Role</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={roleData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
              >
                {roleData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Listings by Status - Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Listings by Status</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={statusData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {statusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Listings by Type - Pie Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Listings by Type</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={typeData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
              >
                {typeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 3 */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Price Distribution - Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Price Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={priceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Users by Location - Bar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Users by Location</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={userLocationChartData.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}