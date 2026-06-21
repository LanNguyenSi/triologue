import { API_BASE } from './apiBase';
import { useAuthStore } from '../stores/authStore';

export async function apiClient(path: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Only add a JSON Content-Type when there is actually a (non-FormData) body.
  // Bodyless GET/DELETE requests stay header-light, matching the pre-refactor
  // shape and avoiding a needless CORS preflight on cross-origin deploys.
  const isFormData = options.body instanceof FormData;
  if (options.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
