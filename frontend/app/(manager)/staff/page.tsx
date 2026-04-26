'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useEffect } from 'react';
import { users as usersApi, type User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { UserPlus, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { todayISO } from '@/lib/utils';

export default function StaffPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const ts = t.staff;

  const [staff, setStaff] = useState<User[]>([]);
  const [workload, setWorkload] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newLang, setNewLang] = useState<'en' | 'cs' | 'ru' | 'uk'>('en');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      usersApi.list(),
      usersApi.workload(todayISO()),
    ]).then(([all, wl]) => {
      setStaff(all.filter(u => u.role === 'CLEANER'));
      const wlMap: Record<string, number> = {};
      wl.forEach((u: any) => { wlMap[u.id] = u.assignmentCount ?? 0; });
      setWorkload(wlMap);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const created = await usersApi.create({ name: newName, email: newEmail, role: 'CLEANER', language: newLang });
      setStaff(prev => [...prev, created]);
      setShowAdd(false);
      setNewName(''); setNewEmail('');
    } catch {}
    finally { setAdding(false); }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{ts.title}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{ts.workload}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition"
        >
          <UserPlus size={15} />
          {ts.addStaff}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-2xl border border-surface-border animate-pulse" />)}
        </div>
      ) : staff.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-surface-border">
          <Users size={32} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm text-ink-muted">{ts.noStaff}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden divide-y divide-surface-border">
          {staff.map(s => {
            const count = workload[s.id] ?? 0;
            return (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-full bg-ink text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {s.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink text-sm">{s.name}</p>
                  <p className="text-xs text-ink-muted truncate">{s.email}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-ink-faint uppercase">{ts.lang[s.language as keyof typeof ts.lang] ?? s.language}</span>
                  <div className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                    count === 0 ? 'bg-surface-sunken text-ink-faint' :
                    count <= 2 ? 'bg-emerald-50 text-emerald-700' :
                    count <= 4 ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700',
                  )}>
                    {count} {ts.assignments}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add staff modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm mx-4 p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-ink">{ts.addStaff}</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-surface-sunken text-ink-muted">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-3">
              <input
                type="text" placeholder="Full name" value={newName}
                onChange={e => setNewName(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="email" placeholder="Email address" value={newEmail}
                onChange={e => setNewEmail(e.target.value)} required
                className="w-full px-3.5 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <select
                value={newLang} onChange={e => setNewLang(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
              >
                {(['en','cs','ru','uk'] as const).map(l => (
                  <option key={l} value={l}>{ts.lang[l]}</option>
                ))}
              </select>
              <button
                type="submit" disabled={adding}
                className="w-full py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50"
              >
                {adding ? t.general.saving : 'Add Staff Member'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
