import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-emerald-700">AGLK</h1>
          <nav className="flex gap-4">
            <Link href="/dashboard" className="px-4 py-2 text-emerald-700 hover:text-emerald-900">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center">
          <h2 className="text-5xl font-bold text-gray-900 mb-6">
            Agricultural Listing & Knowledge
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Connect farmers and buyers, manage listings, and track users all in one place.
          </p>
          <Link 
            href="/dashboard" 
            className="inline-block px-8 py-4 bg-emerald-600 text-white text-lg font-semibold rounded-lg hover:bg-emerald-700 transition"
          >
            Go to Dashboard
          </Link>
        </div>

        <div className="mt-20 grid md:grid-cols-3 gap-8">
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Listings</h3>
            <p className="text-gray-600">Manage agricultural product listings with full details and status tracking.</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Users</h3>
            <p className="text-gray-600">Track all registered users including farmers and buyers with their profiles.</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">Dashboard</h3>
            <p className="text-gray-600">View comprehensive analytics and manage your agricultural marketplace.</p>
          </div>
        </div>
      </main>
    </div>
  );
}