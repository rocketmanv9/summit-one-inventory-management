'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Session {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  fullName: string;
  expiresAt: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry: string;
  address?: any;
  metadata?: any;
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const sessionData = await response.json();
          setSession(sessionData);
          
          // Fetch tenant information
          const tenantResponse = await fetch('/api/tenant');
          if (tenantResponse.ok) {
            const { tenant } = await tenantResponse.json();
            setTenant(tenant);
          }
        } else {
          // Session check failed - redirect to core
          const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
          window.location.href = `${coreUrl}/dashboard`;
        }
      } catch (error) {
        console.error('Session check error:', error);
        const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
        window.location.href = `${coreUrl}/dashboard`;
      } finally {
        setLoading(false);
      }
    }
    
    checkSession();
  }, [router]);
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!session) {
    return null; // Redirecting
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Heading */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
          <p className="mt-2 text-gray-600">
            Manage your inventory items and stock levels
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: User Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              User Information
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-500">Name:</span>
                <p className="text-gray-900">{session.fullName}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">Email:</span>
                <p className="text-gray-900">{session.email}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">Role:</span>
                <p className="text-gray-900 capitalize">{session.role}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">User ID:</span>
                <p className="text-gray-900 font-mono text-sm">{session.userId}</p>
              </div>
            </div>
          </div>
          
          {/* Card 2: Active Tenant */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Active Tenant
            </h2>
            <div className="space-y-3">
              {tenant ? (
                <>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Company Name:</span>
                    <p className="text-gray-900 text-lg font-semibold">{tenant.name}</p>
                  </div>
                  {tenant.industry && (
                    <div>
                      <span className="text-sm font-medium text-gray-500">Industry:</span>
                      <p className="text-gray-900">{tenant.industry}</p>
                    </div>
                  )}
                  {tenant.slug && (
                    <div>
                      <span className="text-sm font-medium text-gray-500">Slug:</span>
                      <p className="text-gray-900 font-mono text-sm">{tenant.slug}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-sm font-medium text-gray-500">Tenant ID:</span>
                    <p className="text-gray-900 font-mono text-xs">{tenant.id}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-sm font-medium text-gray-500">Tenant ID:</span>
                    <p className="text-gray-900 font-mono text-sm">{session.tenantId}</p>
                  </div>
                  <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p className="text-sm text-yellow-800">
                      Tenant details not yet synced from Core. Waiting for webhook events...
                    </p>
                  </div>
                </>
              )}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> All inventory data you see is automatically scoped to this tenant.
                  You can only view and manage items belonging to your organization.
                </p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Card 3: Inventory Items */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Inventory Items
          </h2>
          <div className="p-8 text-center border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-gray-500 mb-2">
              Inventory items list will appear here
            </p>
            <p className="text-sm text-gray-400">
              All items are automatically filtered by tenant: <span className="font-mono">{session.tenantId}</span>
            </p>
            <div className="mt-4">
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                onClick={() => alert('Item management coming soon!')}
              >
                Add New Item
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
