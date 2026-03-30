import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL ?? '/api';
const POLL_INTERVAL_MS = 30_000;

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('triologue_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Polls /api/approvals?status=pending every 30s and returns the count.
 * Returns 0 if not authenticated or request fails.
 */
export function usePendingApprovals(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchCount() {
      try {
        const res = await fetch(`${API}/approvals?status=pending`, { headers: authHeaders() });
        if (!res.ok || !mounted) return;
        const data = await res.json() as { approvals?: unknown[] };
        if (mounted) setCount(data.approvals?.length ?? 0);
      } catch {
        // silent — badge just stays 0
      }
    }

    void fetchCount();
    const interval = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return count;
}
