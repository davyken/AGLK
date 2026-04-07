'use client';

import { useState, useEffect } from 'react';

const API_BASE = 'https://aglk.onrender.com';

interface User {
  _id: string;
  phone: string;
  name: string;
  role: string;
  location: string;
  trustScore: number;
  language: string;
  preferredChannel: string;
  produces: string[];
  needs: string[];
  businessName: string;
  isBanned: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | 'farmer' | 'buyer'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/users`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const getRoleColor = (role: string) => {
    return role === 'farmer' 
      ? 'bg-emerald-900 text-emerald-300' 
      : 'bg-amber-900 text-amber-300';
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 50) return 'text-amber-400';
    return 'text-red-400';
  };

  const filteredUsers = users.filter(user => {
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesSearch = user.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         user.phone.includes(searchQuery);
    return matchesRole && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading users...</div>
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
        <h1 className="text-3xl font-bold text-white mb-8 text-center">Users</h1>

        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-auto"
          />
          <select 
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="all">All Roles</option>
            <option value="farmer">Farmers</option>
            <option value="buyer">Buyers</option>
          </select>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No users found
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800 border-b border-gray-700">
                  <tr>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Name</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Phone</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Role</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Location</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Trust</th>
                    <th className="text-left px-4 sm:px-6 py-3 text-sm font-medium text-gray-400">Channel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredUsers.map((user) => (
                    <tr key={user._id} className="hover:bg-gray-800/50">
                      <td className="px-4 sm:px-6 py-4 font-medium text-white">{user.name || '-'}</td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400 font-mono text-sm">{user.phone}</td>
                      <td className="px-4 sm:px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400">{user.location || '-'}</td>
                      <td className="px-4 sm:px-6 py-4">
                        <span className={`font-medium ${getTrustScoreColor(user.trustScore || 0)}`}>
                          {user.trustScore || 0}%
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-gray-400">{user.preferredChannel || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-500">
          Showing {filteredUsers.length} of {users.length} users
        </div>
      </div>
    </div>
  );
}