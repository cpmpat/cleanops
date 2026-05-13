'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wrench, LogOut, RefreshCw, Calendar, MapPin, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { repairs as repairsApi, ApiError } from '@/lib/api';
import type { Repair } from '@/lib/api';
import { RepairStatusBadge } from '@/components/RepairStatusBadge';

export default function MyRepairsPage() {
  const router = useRouter();
  const { user, loading: authLoading, loadFromStorage, logout } = useAuth();
  const [items, setItems] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadFromStorage(); }, []);

  // Role-aware redirects
  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.replace('/login');
        return;
      }
      if (user.role === 'MANAGER') {
        router.replace('/dashboard');
        return;
      }
      if (user.role === 'CLEANER') {
        router.replace('/cleanings');
        return;
      }
    }
  }, [user, authLoading, router]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await repairsApi.listMine();
      setItems(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'REPAIRMAN') load();
  }, [user]);

  if (authLoading || !user || user.role !== 'REPAIRMAN') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-ink animate-pulse" />
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-surface-border">
        <div className="px-4 py-3 flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-ink text-white flex items-center justify-center">
              <Wrench size={18} />
            </div>
            <div>
              <p className="font-bold text-sm text-ink leading-tight">My repairs</p>
              <p className="text-[11px] text-ink-muted leading-tight">{user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={logout}
              className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 py-4 max-w-2xl mx-auto">
        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm mb-4 flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-white rounded-2xl border border-surface-border animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
            <Wrench size={32} className="mx-auto text-ink-faint mb-2" />
            <p className="font-semibold text-ink">No active repairs</p>
            <p className="text-sm text-ink-muted mt-1">
              When a manager assigns you a repair, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((r) => {
              const due = new Date(r.dueDate);
              const isOverdue = due < now && !['DONE', 'CANCELLED'].includes(r.status);

              return (
                <Link
                  key={r.id}
                  href={`/my-repairs/${r.id}`}
                  className="block bg-white border border-surface-border rounded-2xl p-4 hover:border-ink-faint transition"
                >
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <RepairStatusBadge status={r.status} size="sm" />
                    {isOverdue && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">
                        OVERDUE
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-ink mb-1">{r.title}</p>
                  <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-1">
                    <MapPin size={12} />
                    <span className="truncate">{r.property.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Calendar size={12} className={isOverdue ? 'text-red-600' : 'text-ink-muted'} />
                    <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-ink-muted'}>
                      Due {due.toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
