'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Loader2, Trash2, Package } from 'lucide-react';
import { repairMaterials, ApiError } from '@/lib/api';
import type { RepairMaterial } from '@/lib/api';

export default function RepairMaterialsPage() {
  const [materials, setMaterials] = useState<RepairMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const list = await repairMaterials.list(showInactive);
      setMaterials(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load materials');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await repairMaterials.create({
        name: newName.trim(),
        unit: newUnit.trim() || undefined,
      });
      setNewName('');
      setNewUnit('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add material');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Hide this material from future repairs? Existing usages will be preserved.')) return;
    try {
      await repairMaterials.deactivate(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to deactivate');
    }
  }

  async function handleReactivate(id: string) {
    try {
      await repairMaterials.update(id, { isActive: true });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to reactivate');
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-2 text-xs text-ink-faint">
        <Link href="/repairs" className="flex items-center hover:text-ink transition">
          <ChevronLeft size={14} />
          Back to repairs
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Package size={22} className="text-ink-muted" />
            Repair materials
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Predefined picklist for repairmen to log materials used on each repair
          </p>
        </div>
      </div>

      {/* Add new */}
      <div className="bg-white border border-surface-border rounded-2xl p-4 mb-4">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Add material
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Material name (e.g. Baterie AA)"
            maxLength={100}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            type="text"
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            placeholder="Unit (e.g. ks)"
            maxLength={20}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-28 rounded-xl border border-surface-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={handleCreate}
            disabled={submitting || !newName.trim()}
            className="px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40 flex items-center gap-1.5"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm mb-4">{error}</div>
      )}

      {/* Toggle inactive */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          {showInactive ? 'All materials' : 'Active materials'}
        </p>
        <button
          onClick={() => setShowInactive((v) => !v)}
          className="text-xs text-ink-muted hover:text-ink transition"
        >
          {showInactive ? 'Hide inactive' : 'Show inactive'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-white rounded-xl border border-surface-border animate-pulse" />
          ))}
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-surface-border">
          <Package size={28} className="mx-auto text-ink-faint mb-2" />
          <p className="font-semibold text-ink text-sm">No materials yet</p>
          <p className="text-xs text-ink-muted mt-1">Add your first material above to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-surface-border rounded-2xl divide-y divide-surface-border">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${m.isActive ? 'text-ink' : 'text-ink-faint'}`}>
                  {m.name}
                </p>
                {m.unit && (
                  <p className="text-xs text-ink-muted">{m.unit}</p>
                )}
              </div>
              {!m.isActive && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Inactive
                </span>
              )}
              {m.isActive ? (
                <button
                  onClick={() => handleDeactivate(m.id)}
                  title="Deactivate"
                  className="p-1.5 text-ink-faint hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <button
                  onClick={() => handleReactivate(m.id)}
                  className="px-2 py-1 text-[11px] font-semibold text-ink-muted hover:text-ink hover:bg-surface-sunken rounded-lg transition"
                >
                  Reactivate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
