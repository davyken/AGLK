'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Home() {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-2 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img 
              src="/agrolink_logo_compressed.png" 
              alt="Agrolink" 
            className="w-24 h-24 object-contain"
            />
          </div>
          <div className="flex items-center gap-8">
            <a href="#features" className="text-gray-400 hover:text-white transition text-sm">Features</a>
            <a href="#about" className="text-gray-400 hover:text-white transition text-sm">About</a>
            <Link 
              href="/auth" 
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="min-h-screen pt-28 pb-20 px-6 flex items-center">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                Production Ready
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Agricultural Marketplace for{' '}
                <span className="text-emerald-400">Modern Africa</span>
              </h1>
              <p className="text-xl text-gray-400 mb-8 max-w-lg">
                Connect farmers and buyers seamlessly. Manage listings, track users, 
                and grow your agricultural business with AI-powered insights.
              </p>
              <div className="flex flex-wrap gap-4">
                <a 
                  href="https://wa.me/15551661836" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition"
                >
                  Launch App
                </a>
                <a 
                  href="https://docs.google.com/document/d/1KEBYLReFKUvULvB8uEQCu5NyaEgjDMYduOH7zXOJNNw/edit?tab=t.0#heading=h.quv1v01so6ux" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 border border-gray-700 hover:border-gray-600 text-gray-300 font-medium rounded-lg transition"
                >
                  View Documentation
                </a>
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full"></div>
              <div className="relative bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-gray-500 text-sm ml-2">terminal</span>
                </div>
                <pre className="text-sm font-mono text-gray-300">
                  <span className="text-emerald-400">$</span> curl https://aglk.onrender.com/api/health<br/>
                  <span className="text-gray-500">{"{"}</span><br/>
                  &nbsp;&nbsp;"status": <span className="text-emerald-400">"healthy"</span>,<br/>
                  &nbsp;&nbsp;"uptime": <span className="text-yellow-400">99.9%</span>,<br/>
                  &nbsp;&nbsp;"version": <span className="text-blue-400">"2.0.0"</span><br/>
                  <span className="text-gray-500">{"}"}</span>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-6 bg-gray-900/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Platform Features</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Built with modern technologies to handle the demands of agricultural trading at scale.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: 'User Management',
                description: 'Complete user registration and profile management with role-based access control.',
                icon: '👥',
                color: 'emerald'
              },
              {
                title: 'Listing Management',
                description: 'Create, update, and manage agricultural product listings with real-time status tracking.',
                icon: '📋',
                color: 'blue'
              },
              {
                title: 'Smart Matching',
                description: 'AI-powered matching system that connects buyers with the right sellers automatically.',
                icon: '🔗',
                color: 'purple'
              },
              {
                title: 'Price Intelligence',
                description: 'Market analytics with suggested pricing based on historical data and trends.',
                icon: '💹',
                color: 'yellow'
              },
              {
                title: 'Multi-channel',
                description: 'Support for SMS and WhatsApp integrations for wider reach and accessibility.',
                icon: '📱',
                color: 'pink'
              },
              {
                title: 'Admin Dashboard',
                description: 'Comprehensive dashboard for monitoring, analytics, and platform management.',
                icon: '📊',
                color: 'cyan'
              }
            ].map((feature, idx) => (
              <div 
                key={idx}
                className={`p-6 rounded-xl border transition-all duration-300 cursor-pointer ${
                  hoveredFeature === idx 
                    ? 'bg-gray-800 border-gray-700 scale-105' 
                    : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                }`}
                onMouseEnter={() => setHoveredFeature(idx)}
                onMouseLeave={() => setHoveredFeature(null)}
              >
                <div className="text-3xl mb-4">{feature.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pt-40 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">           
                 <img 
                  src="/agrolink_logo_compressed.png" 
                  alt="Agrolink" 
                  className="w-32 h-32 object-contain" 
                />                <span className="text-2xl font-bold tracking-tight"></span>              </div>
              <p className="text-gray-400 max-w-lg">
                Empowering African agricultural trade through technology. 
                Connecting farmers and buyers for a sustainable future.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Platform</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><Link href="/dashboard" className="hover:text-white transition">Dashboard</Link></li>
                <li><Link href="/dashboard/listings" className="hover:text-white transition">Listings</Link></li>
                <li><Link href="/dashboard/users" className="hover:text-white transition">Users</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-white transition">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition">API Reference</a></li>
                <li><a href="#" className="hover:text-white transition">Support</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-12 pt-8 text-center text-gray-500 text-sm">
            © 2026 AGLK. Built with NestJS & Next.js
          </div>
        </div>
      </section>
    </div>
  );
}