import { getSessionToken } from './auth';

export interface BillingSummary {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  isAdmin: boolean;
  status: 'active' | 'blocked';
  blockedReason?: string;
  balanceCredits: number;
  reservedCredits: number;
  availableCredits: number;
  spentCredits: number;
  purchasedCredits: number;
  bonusCredits: number;
  lowBalance: boolean;
  lowBalanceThreshold: number;
  activePlan: string;
}

export interface BillingPackage {
  id: string;
  name: string;
  credits: number;
  amountRub: number;
  currency: string;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  bucket: string;
  description?: string;
  related_id?: string;
  created_at: string;
}

export interface AiRequestRow {
  id: string;
  provider: string;
  model: string;
  kind: string;
  status: string;
  estimated_credits: number;
  actual_credits: number;
  pricing_version_id?: string;
  created_at: string;
  finished_at?: string;
}

export interface ByokKey {
  id: string;
  provider: string;
  key_mask: string;
  enabled: number;
  monthly_limit_credits?: number;
  spent_this_month_credits: number;
}

export interface SubscriptionPlan {
  id: 'Free' | 'Plus' | 'Pro';
  name: string;
  monthlyCredits: number;
  modelLimit: string;
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || res.statusText);
  }
  return data as T;
}

export async function fetchBillingSummary() {
  const data = await api<{ success: boolean; summary: BillingSummary }>('/api/billing/summary');
  return data.summary;
}

export async function fetchTransactions(type?: string) {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const data = await api<{ success: boolean; transactions: LedgerEntry[] }>(`/api/billing/transactions${query}`);
  return data.transactions;
}

export async function fetchAiRequests() {
  const data = await api<{ success: boolean; aiRequests: AiRequestRow[] }>('/api/billing/ai-requests');
  return data.aiRequests;
}

export async function fetchBillingPackages() {
  const data = await api<{ success: boolean; packages: BillingPackage[] }>('/api/billing/packages');
  return data.packages;
}

export async function fetchSubscriptionPlans() {
  const data = await api<{ success: boolean; plans: SubscriptionPlan[] }>('/api/billing/subscription-plans');
  return data.plans;
}

export async function changeSubscription(plan: string) {
  const data = await api<{ success: boolean; summary: BillingSummary }>('/api/billing/subscription', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
  return data.summary;
}

export async function cancelSubscription() {
  const data = await api<{ success: boolean; summary: BillingSummary }>('/api/billing/subscription/cancel', { method: 'POST' });
  return data.summary;
}

export async function claimDailyBonus() {
  const data = await api<{ success: boolean; summary: BillingSummary }>('/api/billing/daily-bonus', { method: 'POST' });
  return data.summary;
}

export async function createYooKassaPayment(packageId: string) {
  const data = await api<{ success: boolean; payment: { confirmationUrl?: string; mock?: boolean } }>(
    '/api/payments/yookassa/create',
    {
      method: 'POST',
      body: JSON.stringify({ packageId, returnUrl: window.location.origin }),
    }
  );
  return data.payment;
}

export async function fetchStoredByokKeys() {
  const data = await api<{ success: boolean; keys: ByokKey[] }>('/api/byok/stored');
  return data.keys;
}

export async function setSessionByokKey(provider: string, key: string) {
  return api<{ success: boolean; key: { provider: string; mask: string } }>('/api/byok/session', {
    method: 'POST',
    body: JSON.stringify({ provider, key }),
  });
}

export async function clearSessionByokKey() {
  return api<{ success: boolean }>('/api/byok/session', { method: 'DELETE' });
}

export async function saveStoredByok(provider: string, key: string, monthlyLimitCredits?: number) {
  const data = await api<{ success: boolean; keys: ByokKey[] }>('/api/byok/stored', {
    method: 'POST',
    body: JSON.stringify({ provider, key, monthlyLimitCredits }),
  });
  return data.keys;
}

export async function deleteStoredByok(provider: string) {
  const data = await api<{ success: boolean; keys: ByokKey[] }>('/api/byok/stored', {
    method: 'DELETE',
    body: JSON.stringify({ provider }),
  });
  return data.keys;
}

export async function adminSearchUsers(query: string) {
  const data = await api<{ success: boolean; users: any[] }>(`/api/admin/users?query=${encodeURIComponent(query)}`);
  return data.users;
}

export async function adminFetchUserBilling(userId: string) {
  const data = await api<{ success: boolean; user: any }>(`/api/admin/users/${encodeURIComponent(userId)}/billing`);
  return data.user;
}

export async function adminAdjustUser(userId: string, action: 'credit' | 'debit' | 'correction', amount: number, reason: string) {
  const data = await api<{ success: boolean; user: any }>(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason }),
  });
  return data.user;
}

export async function adminBlockUser(userId: string, blocked: boolean, reason: string) {
  const data = await api<{ success: boolean; user: any }>(`/api/admin/users/${encodeURIComponent(userId)}/block`, {
    method: 'POST',
    body: JSON.stringify({ blocked, reason }),
  });
  return data.user;
}

export async function adminFetchAnalytics() {
  const data = await api<{ success: boolean; analytics: any }>('/api/admin/analytics');
  return data.analytics;
}
