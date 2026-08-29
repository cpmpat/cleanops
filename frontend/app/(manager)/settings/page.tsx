'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useEffect } from 'react';
import { tenant as tenantApi, integrations, help as helpApi, ApiError, type HelpDocMeta } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { Settings, Wifi, WifiOff, RefreshCw, Eye, EyeOff, Save, BookOpen, Upload } from 'lucide-react';
import { useMessageStrings } from '@/i18n/messages';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const ts = t.settings;
  const m = useMessageStrings(locale).manager;

  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [datasetsSheet, setDatasetsSheet] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  // In-app manual
  const [helpDocs, setHelpDocs] = useState<HelpDocMeta[]>([]);
  const [helpUploading, setHelpUploading] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [helpError, setHelpError] = useState('');

  useEffect(() => {
    tenantApi.get().then((data: any) => {
      setApiBaseUrl(data.pmsApiBaseUrl ?? '');
      setApiKey(data.pmsApiKey ?? '');
      setSyncEnabled(data.pmsSyncEnabled ?? true);
      setDatasetsSheet(data.datasetsSheetId ?? '');
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await tenantApi.updatePmsConfig({
        pmsApiBaseUrl: apiBaseUrl,
        pmsApiKey: apiKey,
        pmsSyncEnabled: syncEnabled,
        pmsProvider: 'avantio',
        datasetsSheetId: datasetsSheet,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true); setConnectionStatus('idle');
    try {
      const res = await integrations.testConnection();
      setConnectionStatus(res.connected ? 'ok' : 'fail');
    } catch { setConnectionStatus('fail'); }
    finally { setTesting(false); }
  }

  async function handleSync() {
    setSyncing(true); setSyncDone(false); setSyncResult(null);
    try {
      const res = await integrations.sync();
      setSyncResult(res);
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 5000);
    } catch {}
    finally { setSyncing(false); }
  }

  useEffect(() => {
    helpApi.list().then(setHelpDocs).catch(() => {});
  }, []);

  /**
   * The manual is authored outside the app and exported as one HTML file with
   * a tab per language; the backend splits it into one document per language.
   * Uploading is all it takes — no release, no deploy.
   */
  async function handleHelpUpload(file: File) {
    setHelpUploading(true);
    setHelpMessage('');
    setHelpError('');
    try {
      const html = await file.text();
      const result = await helpApi.import(html);
      setHelpMessage(m.helpImported(result.imported.join(', ')));
      setHelpDocs(await helpApi.list());
    } catch (err) {
      setHelpError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setHelpUploading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{ts.title}</h1>
      </div>

      {/* PMS Config */}
      <div className="bg-white rounded-2xl border border-surface-border p-5 mb-4">
        <div className="flex items-center gap-2 mb-5">
          <Settings size={16} className="text-ink-muted" />
          <h2 className="font-semibold text-ink">{ts.pmsConfig}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
              {ts.apiBaseUrl}
            </label>
            <input
              type="url"
              value={apiBaseUrl}
              onChange={e => setApiBaseUrl(e.target.value)}
              placeholder="https://api.avantio.pro/pms/v2"
              className="w-full px-3.5 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
              {ts.apiKey}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface font-mono"
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-muted"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-ink">{ts.syncEnabled}</p>
              <p className="text-xs text-ink-muted">Auto-sync every 5 minutes</p>
            </div>
            <button
              onClick={() => setSyncEnabled(v => !v)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                syncEnabled ? 'bg-accent' : 'bg-surface-border',
              )}
            >
              <span className={cn(
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                syncEnabled ? 'translate-x-5' : 'translate-x-0',
              )} />
            </button>
          </div>

          <div className="pt-4 border-t border-surface-border">
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
              Datasets source
            </label>
            <input
              value={datasetsSheet}
              onChange={e => setDatasetsSheet(e.target.value)}
              placeholder="Paste the Google Sheets link or id"
              className="w-full px-3.5 py-2.5 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface font-mono"
            />
            <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">
              Read-only. Share the sheet with the service account as <b>Viewer</b> —
              nothing in the app ever writes back to it.
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-5 pt-4 border-t border-surface-border">
          <button
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="flex items-center gap-2 px-4 py-2 border border-surface-border rounded-xl text-sm font-medium text-ink hover:bg-surface-sunken transition disabled:opacity-40"
          >
            {connectionStatus === 'ok' ? <Wifi size={14} className="text-emerald-500" /> :
             connectionStatus === 'fail' ? <WifiOff size={14} className="text-red-500" /> :
             <Wifi size={14} />}
            {testing ? 'Testing...' :
             connectionStatus === 'ok' ? ts.connected :
             connectionStatus === 'fail' ? ts.notConnected :
             ts.testConnection}
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 ml-auto"
          >
            <Save size={14} />
            {saving ? t.general.saving : saved ? 'Saved ✓' : t.general.save}
          </button>
        </div>
      </div>

      {/* Manual sync */}
      <div className="bg-white rounded-2xl border border-surface-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw size={16} className="text-ink-muted" />
          <h2 className="font-semibold text-ink">{ts.manualSync}</h2>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Force a full sync of accommodations and bookings from Avantio right now.
          The automatic sync runs every 5 minutes.
        </p>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? ts.syncing : syncDone ? ts.syncDone : ts.manualSync}
        </button>

        {syncResult && (
          <div className="mt-4 p-3.5 bg-surface-sunken rounded-xl text-xs text-ink-muted space-y-1 font-mono">
            <p>Accommodations: {syncResult.accommodations?.created} created, {syncResult.accommodations?.updated} updated</p>
            <p>Bookings: {syncResult.bookings?.created} new events, {syncResult.bookings?.updated} updated, {syncResult.bookings?.cancelled} cancelled</p>
          </div>
        )}
      </div>

      {/* In-app manual */}
      <div className="bg-white rounded-2xl border border-surface-border p-5 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={16} className="text-ink-muted" />
          <h2 className="font-semibold text-ink">{m.helpTitle}</h2>
        </div>
        <p className="text-sm text-ink-muted mb-4">{m.helpHint}</p>

        <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition cursor-pointer disabled:opacity-50">
          <Upload size={14} />
          {helpUploading ? m.helpUploading : m.helpUpload}
          <input
            type="file"
            accept=".html,text/html"
            className="hidden"
            disabled={helpUploading}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleHelpUpload(file);
              e.target.value = '';
            }}
          />
        </label>

        {helpMessage && <p className="text-sm text-emerald-700 mt-3">{helpMessage}</p>}
        {helpError && <p className="text-sm text-red-600 mt-3">{helpError}</p>}

        <div className="mt-4">
          {helpDocs.length === 0 ? (
            <p className="text-sm text-ink-muted">{m.helpNone}</p>
          ) : (
            <div className="border border-surface-border rounded-xl divide-y divide-surface-border">
              {helpDocs.map(doc => (
                <div key={doc.locale} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-ink uppercase w-8">{doc.locale}</span>
                  <span className="flex-1 min-w-0 truncate text-ink-muted">{doc.title ?? '—'}</span>
                  <span className="text-xs text-ink-faint whitespace-nowrap">
                    {m.helpVersion(doc.version, new Date(doc.publishedAt).toLocaleDateString())}
                  </span>
                  {doc.bytes != null && (
                    <span className="text-xs text-ink-faint whitespace-nowrap">
                      {m.helpSize(Math.round(doc.bytes / 1024))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
