'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalListings: 0, totalUsers: 0, activeListings: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('https://aglk.onrender.com/listing').then(res => res.json()),
      fetch('https://aglk.onrender.com/users').then(res => res.json()),
    ])
      .then(([listingsData, usersData]) => {
        const listings = Array.isArray(listingsData) ? listingsData : listingsData.data || [];
        const users = Array.isArray(usersData) ? usersData : usersData.data || [];
        const activeListings = listings.filter((l: { status: string }) => l.status === 'active').length;
        setStats({
          totalListings: listings.length,
          totalUsers: users.length,
          activeListings,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Listings</h3>
          <p className="text-4xl font-bold text-emerald-600">
            {loading ? '...' : stats.totalListings}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Users</h3>
          <p className="text-4xl font-bold text-emerald-600">
            {loading ? '...' : stats.totalUsers}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Active Listings</h3>
          <p className="text-4xl font-bold text-emerald-600">
            {loading ? '...' : stats.activeListings}
          </p>
        </div>
      </div>
      <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Welcome to AGLK</h2>
        <p className="text-gray-600">
          Navigate to Listings or Users from the sidebar to view and manage your data.
        </p>
      </div>
    </div>
  );
}