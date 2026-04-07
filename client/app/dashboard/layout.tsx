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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2">
                <img 
                  src="/agrolink_logo_compressed.png" 
                  alt="Agrolink" 
                  className="w-20 h-20 object-contain"
                />
                <span className="text-lg font-bold text-gray-900 hidden sm:block">Agrolink</span>
              </Link>
              <div className="hidden md:flex gap-6">
                <Link 
                  href="/dashboard" 
                  className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                >
                  Dashboard
                </Link>
                <Link 
                  href="/dashboard/listings" 
                  className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                >
                  Listings
                </Link>
                <Link 
                  href="/dashboard/users" 
                  className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
                >
                  Users
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              <button 
                onClick={() => {
                  localStorage.removeItem('user');
                  router.push('/auth');
                }}
                className="text-gray-500 hover:text-gray-700 text-xs md:text-sm"
              >
                Sign Out
              </button>
              <Link 
                href="/" 
                className="text-gray-500 hover:text-gray-700 text-xs md:text-sm hidden sm:block"
              >
                Back to Home
              </Link>
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 px-4 py-3 space-y-2">
            <Link 
              href="/dashboard" 
              className="block text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link 
              href="/dashboard/listings" 
              className="block text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              Listings
            </Link>
            <Link 
              href="/dashboard/users" 
              className="block text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium"
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