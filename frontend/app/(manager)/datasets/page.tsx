'use client';
import { Database, Lock, Eye, Edit3 } from 'lucide-react';

export default function DatasetsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Database size={22} className="text-ink-muted" />
          Datasets
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">
          Read-only data views from BigQuery & Google Sheets
        </p>
      </div>

      {/* Coming soon card */}
      <div className="bg-white border border-surface-border rounded-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-surface-sunken mx-auto mb-4 flex items-center justify-center">
          <Database size={26} className="text-ink-muted" />
        </div>
        <h2 className="text-lg font-bold text-ink mb-1">Coming soon</h2>
        <p className="text-sm text-ink-muted max-w-md mx-auto">
          Connect your operational data sources here. Filtered views with
          field-level permissions per role.
        </p>

        {/* Preview features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8 text-left">
          <FeaturePreview
            icon={<Database size={18} />}
            title="Live data sources"
            description="Pull from Google BigQuery or Google Sheets without manual exports."
          />
          <FeaturePreview
            icon={<Eye size={18} />}
            title="Role-based visibility"
            description="Configure which columns each role can see \u2014 cleaners vs. managers."
          />
          <FeaturePreview
            icon={<Edit3 size={18} />}
            title="Inline edits"
            description="Permissioned write-back to the source for fields you choose to expose."
          />
        </div>
      </div>
    </div>
  );
}

function FeaturePreview({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-surface-border p-4 bg-surface">
      <div className="w-8 h-8 rounded-lg bg-white border border-surface-border flex items-center justify-center text-ink-muted mb-2">
        {icon}
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-xs text-ink-muted mt-1 leading-relaxed">{description}</p>
    </div>
  );
}
