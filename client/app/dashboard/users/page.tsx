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

interface EditForm {
  name: string;
  role: string;
  location: string;
  preferredChannel: string;
  businessName: string;
  language: string;
  produces: string;
  needs: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | 'farmer' | 'buyer'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', role: '', location: '', preferredChannel: '', 
    businessName: '', language: '', produces: '', needs: ''
  });
  const [saving, setSaving] = useState(false);
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

  const handleBan = async (user: User) => {
    try {
      const res = await fetch(`${API_BASE}/users/${user.phone}/ban`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: !user.isBanned }),
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
      }
    } catch (err) {
      console.error(err);
    }
    setMenuOpen(null);
  };

  const getRoleColor = (role: string) => {
    return role === 'farmer' 
      ? 'bg-emerald-100 text-emerald-800' 
      : 'bg-amber-100 text-amber-800';
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const filteredUsers = users.filter(user => {
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesSearch = user.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         user.phone.includes(searchQuery);
    return matchesRole && matchesSearch;
  });

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || '',
      role: user.role || '',
      location: user.location || '',
      preferredChannel: user.preferredChannel || '',
      businessName: user.businessName || '',
      language: user.language || '',
      produces: user.produces?.join(', ') || '',
      needs: user.needs?.join(', ') || ''
    });
  };

  const toggleBan = (user: User) => {
    handleBan(user);
  };

  const saveUser = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/users/${editingUser.phone}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          produces: editForm.produces.split(',').map(p => p.trim()).filter(Boolean),
          needs: editForm.needs.split(',').map(n => n.trim()).filter(Boolean)
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        setEditingUser(null);
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 animate-pulse">Loading users...</div>
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
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <select 
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="all">All Roles</option>
            <option value="farmer">Farmers</option>
            <option value="buyer">Buyers</option>
          </select>
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No users found
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Name</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Phone</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Location</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Trust</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Channel</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map((user) => (
                <tr key={user._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{user.name || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-sm">{user.phone}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{user.location || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`font-medium ${getTrustScoreColor(user.trustScore || 0)}`}>
                      {user.trustScore || 0}%
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{user.preferredChannel || '-'}</td>
                  <td className="px-6 py-4 relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === user.phone ? null : user.phone)}
                      className="p-2 hover:bg-gray-100 rounded-lg"
                    >
                      <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                    {menuOpen === user.phone && (
                      <div className="absolute right-6 top-10 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                        <button
                          onClick={() => openEdit(user)}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => toggleBan(user)}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          {user.isBanned ? 'Unban' : 'Ban'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-sm text-gray-500">
        Showing {filteredUsers.length} of {users.length} users
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200">
            <h2 className="text-xl font-bold mb-4">Edit User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="farmer">Farmer</option>
                  <option value="buyer">Buyer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={editForm.location}
                  onChange={(e) => setEditForm({...editForm, location: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                <select
                  value={editForm.preferredChannel}
                  onChange={(e) => setEditForm({...editForm, preferredChannel: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                <select
                  value={editForm.language}
                  onChange={(e) => setEditForm({...editForm, language: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="english">English</option>
                  <option value="french">French</option>
                  <option value="pidgin">Pidgin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                <input
                  type="text"
                  value={editForm.businessName}
                  onChange={(e) => setEditForm({...editForm, businessName: e.target.value})}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Produces (comma separated)</label>
                <input
                  type="text"
                  value={editForm.produces}
                  onChange={(e) => setEditForm({...editForm, produces: e.target.value})}
                  placeholder="maize, tomatoes"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Needs (comma separated)</label>
                <input
                  type="text"
                  value={editForm.needs}
                  onChange={(e) => setEditForm({...editForm, needs: e.target.value})}
                  placeholder="maize, beans"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingUser(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveUser}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}