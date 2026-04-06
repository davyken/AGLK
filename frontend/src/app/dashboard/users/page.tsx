'use client';

import { useState, useEffect } from 'react';

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
}

const hiddenFields = ['phone', 'trustScore'];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['phone', 'trustScore']));

  useEffect(() => {
    fetch('https://aglk.onrender.com/users')
      .then(res => res.json())
      .then(data => {
        const usersData = data.data || data;
        setUsers(Array.isArray(usersData) ? usersData : []);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to fetch users');
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
        <div className="text-gray-500">Loading users...</div>
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
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
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
                <td className="px-4 py-3">
                  <button className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
                    📝
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
    </div>
  );
}