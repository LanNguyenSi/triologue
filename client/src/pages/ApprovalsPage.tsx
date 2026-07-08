import React, { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon, CheckIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, EmptyState } from '../components/ui/primitives';
import { apiClient } from '../lib/apiClient';

interface ApprovalRequest {
  id: string;
  connectorId: string;
  actionId: string;
  riskLevel: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  taskId: string | null;
  projectId: string | null;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

function riskBadgeVariant(risk: string): 'danger' | 'warning' | 'info' {
  if (risk === 'high') return 'danger';
  if (risk === 'medium') return 'warning';
  return 'info';
}

function statusBadgeVariant(status: string): 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

export const ApprovalsPage: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient(`/api/approvals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { approvals?: ApprovalRequest[] };
      const items = data.approvals ?? [];
      items.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setApprovals(items);
    } catch {
      setError(t('approvals.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, status: 'approved' | 'rejected') {
    setDeciding(d => ({ ...d, [id]: true }));
    try {
      const res = await apiClient(`/api/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'PATCH',
        body: JSON.stringify({ status, decisionNote: decisionNote[id] ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch {
      setError(t('approvals.error.decide'));
    } finally {
      setDeciding(d => ({ ...d, [id]: false }));
    }
  }

  const pending = approvals.filter(a => a.status === 'pending');
  const decided = approvals.filter(a => a.status !== 'pending');

  return (
    <PageShell
      maxWidth="6xl"
      title={t('approvals.title')}
      subtitle={t('approvals.subtitle')}
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t('approvals.refresh')}
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('approvals.refresh')}
        </Button>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${isDark ? 'bg-red-900/20 border-red-700/40 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {error}
          </div>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('approvals.pending')} ({pending.length})
            </h2>
            {pending.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isDark={isDark}
                t={t}
                note={decisionNote[approval.id] ?? ''}
                onNoteChange={n => setDecisionNote(d => ({ ...d, [approval.id]: n }))}
                onApprove={() => void decide(approval.id, 'approved')}
                onReject={() => void decide(approval.id, 'rejected')}
                deciding={deciding[approval.id] ?? false}
              />
            ))}
          </section>
        )}

        {pending.length === 0 && !loading && (
          <EmptyState
            icon={<CheckIcon className="w-8 h-8" />}
            title={t('approvals.empty')}
          />
        )}

        {/* History */}
        {decided.length > 0 && (
          <section className="space-y-2">
            <h2 className={`text-sm font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('approvals.history')}
            </h2>
            {decided.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isDark={isDark}
                t={t}
                note=""
                onNoteChange={() => { /* intentionally empty: read-only history card, note editing is disabled */ }}
                onApprove={() => { /* intentionally empty: read-only history card, approval already decided */ }}
                onReject={() => { /* intentionally empty: read-only history card, approval already decided */ }}
                deciding={false}
                readOnly
              />
            ))}
          </section>
        )}
      </div>
    </PageShell>
  );
};

interface ApprovalCardProps {
  approval: ApprovalRequest;
  isDark: boolean;
  t: (key: string) => string;
  note: string;
  onNoteChange: (n: string) => void;
  onApprove: () => void;
  onReject: () => void;
  deciding: boolean;
  readOnly?: boolean;
}

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approval, isDark, t, note, onNoteChange, onApprove, onReject, deciding, readOnly = false,
}) => (
  <div className={`rounded-lg border px-4 py-3 space-y-3 transition-colors duration-200 ${
    isDark ? 'bg-gray-900/60 border-gray-700/50' : 'bg-white border-gray-200/60'
  }`}>
    {/* Top row */}
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-sm font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            {approval.connectorId} / {approval.actionId}
          </span>
          <Badge variant={riskBadgeVariant(approval.riskLevel)}>
            {approval.riskLevel} {t('approvals.risk')}
          </Badge>
          <Badge variant={statusBadgeVariant(approval.status)}>
            {approval.status}
          </Badge>
        </div>
        {approval.reason && (
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {approval.reason}
          </p>
        )}
      </div>
      <div className={`flex items-center gap-1 text-xs shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
        <ClockIcon className="w-3.5 h-3.5" />
        {formatDate(approval.createdAt)}
      </div>
    </div>

    {/* Meta row */}
    {(approval.taskId || approval.decisionNote || approval.decidedAt) && (
      <div className={`flex items-center gap-4 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {approval.taskId && (
          <span>{t('approvals.task')}: <span className="font-mono">{approval.taskId.slice(0, 12)}…</span></span>
        )}
        {approval.decisionNote && (
          <span>{approval.decisionNote}</span>
        )}
        {approval.decidedAt && (
          <span>{t('approvals.decided')}: {formatDate(approval.decidedAt)}</span>
        )}
      </div>
    )}

    {/* Action row — only for pending */}
    {!readOnly && approval.status === 'pending' && (
      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={t('approvals.note.placeholder')}
          className={`flex-1 text-xs rounded-lg px-3 py-1.5 border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-600'
              : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
          }`}
        />
        <button
          type="button"
          onClick={onApprove}
          disabled={deciding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors"
        >
          <CheckIcon className="w-3.5 h-3.5" />
          {t('approvals.approve')}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={deciding}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
          {t('approvals.reject')}
        </button>
      </div>
    )}
  </div>
);
