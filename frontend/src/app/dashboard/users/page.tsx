'use client';

import { useState, useEffect } from 'react';

const API_BASE = 'https://aglk.onrender.com';

interface User {
  _id: string;
  phone: string;
  name: string;
  role: string;
  location: string;
  preferredChannel: string;
  lastChannelUsed: string;
  trustScore: number;
  produces: string[];
  needs: string[];
  conversationState: string;
  createdAt: string;
  updatedAt: string;
  businessName?: string;
  language?: string;
  isBanned?: boolean;
}

const hiddenFields = ['phone', 'trustScore'];

function fetchWithTimeout(promise: Promise<Response>, timeout = 10000): Promise<Response> {
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['phone', 'trustScore']));
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ name: '', role: '', location: '', businessName: '', trustScore: 0 });
  const [saving, setSaving] = useState(false);

  const fetchUsers = () => {
    setLoading(true);
    setError(null);
    
    fetchWithTimeout(fetch(`${API_BASE}/users`))
      .then(res => res.json())
      .then(data => {
        const usersData = data.data || data;
        setUsers(Array.isArray(usersData) ? usersData : []);
        setLoading(false);
      })
      .catch(err => {
        setError('Server may be starting up (can take ~30s)');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchUsers();
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

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name || '',
      role: user.role || '',
      location: user.location || '',
      businessName: user.businessName || '',
      trustScore: user.trustScore || 0,
    });
  };

  const closeModal = () => {
    setEditingUser(null);
    setFormData({ name: '', role: '', location: '', businessName: '', trustScore: 0 });
  };

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/users/${editingUser.phone}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      fetchUsers();
      closeModal();
    } catch (err) {
      alert('Failed to update user');
    }
    setSaving(false);
  };

  const toggleBan = async (user: User) => {
    try {
      await fetch(`${API_BASE}/users/${user.phone}/ban`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: !user.isBanned }),
      });
      fetchUsers();
    } catch (err) {
      alert('Failed to toggle ban status');
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'Array (empty)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const columns: { key: keyof User; label: string; visible: boolean }[] = [
    { key: 'phone', label: 'Phone', visible: !hiddenColumns.has('phone') },
    { key: 'name', label: 'Name', visible: true },
    { key: 'role', label: 'Role', visible: true },
    { key: 'location', label: 'Location', visible: true },
    { key: 'lastChannelUsed', label: 'Last Channel Used', visible: true },
    { key: 'trustScore', label: 'Trust Score', visible: !hiddenColumns.has('trustScore') },
    { key: 'produces', label: 'Produces', visible: true },
    { key: 'needs', label: 'Needs', visible: true },
    { key: 'conversationState', label: 'Conversation State', visible: true },
    { key: 'businessName', label: 'Business Name', visible: true },
  ];

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
          onClick={fetchUsers}
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
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <div className="flex gap-2">
          <button 
            onClick={fetchUsers}
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
              {field.charAt(0).toUpperCase() + field.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full min-w-[1400px]">
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
            {users.map(user => (
              <tr key={user._id} className="hover:bg-gray-50">
                {columns.filter(col => col.visible).map(col => (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap"
                  >
                    {formatValue(user[col.key])}
                  </td>
                ))}
                <td className="px-4 py-3 flex gap-2">
                  <button 
                    onClick={() => openEditModal(user)} 
                    className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                    title="Edit user"
                  >
                    ⚙️
                  </button>
                  <button 
                    onClick={() => toggleBan(user)} 
                    className={`p-2 rounded-lg transition ${user.isBanned ? 'bg-red-100 text-red-600' : 'text-gray-500 hover:text-red-600 hover:bg-red-50'}`}
                    title={user.isBanned ? 'Unban user' : 'Ban user'}
                  >
                    {user.isBanned ? '🚫' : '⛔'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={columns.filter(c => c.visible).length + 1} className="px-4 py-8 text-center text-gray-500">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold mb-4">Edit User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                  <option value="farmer">Farmer</option>
                  <option value="buyer">Buyer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                <input
                  type="text"
                  value={formData.businessName}
                  onChange={e => setFormData({ ...formData, businessName: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trust Score</label>
                <input
                  type="number"
                  value={formData.trustScore}
                  onChange={e => setFormData({ ...formData, trustScore: parseInt(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
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