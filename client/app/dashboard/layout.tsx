'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem('user');
    if (!user) {
      router.push('/auth');
    } else {
      setLoading(false); 
    }
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center gap-2">
                <img 
                  src="/agrolink_logo_compressed.png" 
                  alt="Agrolink" 
                  className="w-20 h-20 object-contain"
                />
              </Link>
            </div>
            <div className="flex justify-center gap-8">
              <Link 
                href="/dashboard" 
                className="text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              >
                Dashboard
              </Link>
              <Link 
                href="/dashboard/listings" 
                className="text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              >
                Listings
              </Link>
              <Link 
                href="/dashboard/users" 
                className="text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              >
                Users
              </Link>
            </div>
            <div className="flex justify-end items-center gap-2">
              <Link 
                href="/" 
                className="p-2 text-gray-400 hover:text-white"
                title="Back to Home"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </Link>
              <button 
                onClick={() => {
                  localStorage.removeItem('user');
                  router.push('/auth');
                }}
                className="p-2 text-gray-400 hover:text-white"
                title="Sign Out"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-800 px-4 py-3 space-y-2">
            <Link 
              href="/dashboard" 
              className="block text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link 
              href="/dashboard/listings" 
              className="block text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              Listings
            </Link>
            <Link 
              href="/dashboard/users" 
              className="block text-gray-300 hover:text-white px-3 py-2 text-sm font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              Users
            </Link>
          </div>
        )}
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
}