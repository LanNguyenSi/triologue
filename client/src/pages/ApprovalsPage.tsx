import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, XMarkIcon, ArrowPathIcon, ClockIcon } from '@heroicons/react/24/outline';
import { useTheme } from '../contexts/ThemeContext';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card } from '../components/ui/primitives';

const API = import.meta.env.VITE_API_URL ?? '/api';

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

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('triologue_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
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
      const res = await fetch(`${API}/approvals`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { approvals?: ApprovalRequest[] };
      const items = data.approvals ?? [];
      // pending first, then by date descending
      items.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setApprovals(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, status: 'approved' | 'rejected') {
    setDeciding(d => ({ ...d, [id]: true }));
    try {
      const res = await fetch(`${API}/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status, decisionNote: decisionNote[id] ?? null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setDeciding(d => ({ ...d, [id]: false }));
    }
  }

  const pending = approvals.filter(a => a.status === 'pending');
  const decided = approvals.filter(a => a.status !== 'pending');

  return (
    <PageShell title="Approvals">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Approvals
            </h1>
            <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Review and approve agent connector actions requiring human sign-off.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            title="Refresh"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Pending ({pending.length})
            </h2>
            {pending.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isDark={isDark}
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
          <div className={`flex flex-col items-center justify-center py-12 gap-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <CheckIcon className="w-8 h-8" />
            <p className="text-sm">No pending approvals</p>
          </div>
        )}

        {/* Decided */}
        {decided.length > 0 && (
          <section className="space-y-2">
            <h2 className={`text-sm font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              History
            </h2>
            {decided.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isDark={isDark}
                note=""
                onNoteChange={() => {}}
                onApprove={() => {}}
                onReject={() => {}}
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
  note: string;
  onNoteChange: (n: string) => void;
  onApprove: () => void;
  onReject: () => void;
  deciding: boolean;
  readOnly?: boolean;
}

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approval, isDark, note, onNoteChange, onApprove, onReject, deciding, readOnly = false,
}) => {
  const riskVariant = riskBadgeVariant(approval.riskLevel);
  const statusVariant = statusBadgeVariant(approval.status);

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-mono text-sm font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              {approval.connectorId} / {approval.actionId}
            </span>
            <Badge variant={riskVariant}>{approval.riskLevel} risk</Badge>
            <Badge variant={statusVariant}>{approval.status}</Badge>
          </div>
          {approval.reason && (
            <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {approval.reason}
            </p>
          )}
        </div>
        <div className={`flex items-center gap-1 text-xs shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          <ClockIcon className="w-3.5 h-3.5" />
          {formatDate(approval.createdAt)}
        </div>
      </div>

      {/* Links */}
      <div className="flex items-center gap-3 text-xs">
        {approval.taskId && (
          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
            Task: <span className="font-mono">{approval.taskId.slice(0, 12)}…</span>
          </span>
        )}
        {approval.decisionNote && (
          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
            Note: {approval.decisionNote}
          </span>
        )}
        {approval.decidedAt && (
          <span className={isDark ? 'text-gray-600' : 'text-gray-300'}>
            Decided {formatDate(approval.decidedAt)}
          </span>
        )}
      </div>

      {/* Action row — only for pending */}
      {!readOnly && approval.status === 'pending' && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder="Optional note…"
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
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={deciding}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
};
