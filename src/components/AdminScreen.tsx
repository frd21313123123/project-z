import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Ban, BarChart3, Loader2, Search, ShieldCheck, Wallet } from 'lucide-react';
import {
  adminAdjustUser,
  adminBlockUser,
  adminFetchAnalytics,
  adminFetchUserBilling,
  adminSearchUsers,
} from '../lib/billing';

interface AdminScreenProps {
  onBack: () => void;
}

const formatCredits = (value = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);

export function AdminScreen({ onBack }: AdminScreenProps) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadUsers = async (needle = query) => {
    setIsLoading(true);
    try {
      const [nextUsers, nextAnalytics] = await Promise.all([
        adminSearchUsers(needle),
        adminFetchAnalytics(),
      ]);
      setUsers(nextUsers);
      setAnalytics(nextAnalytics);
    } catch (err: any) {
      setMessage(err.message || 'Не удалось загрузить админку');
    } finally {
      setIsLoading(false);
    }
  };

  const selectUser = async (userId: string) => {
    setSelectedUserId(userId);
    setIsLoading(true);
    try {
      setSelectedUser(await adminFetchUserBilling(userId));
    } catch (err: any) {
      setMessage(err.message || 'Не удалось открыть пользователя');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers('');
  }, []);

  const handleAdjust = async (action: 'credit' | 'debit' | 'correction') => {
    if (!selectedUserId) return;
    try {
      const nextUser = await adminAdjustUser(selectedUserId, action, Number(amount), reason);
      setSelectedUser(nextUser);
      setAmount('');
      setReason('');
      await loadUsers();
    } catch (err: any) {
      setMessage(err.message || 'Операция не выполнена');
    }
  };

  const handleBlock = async (blocked: boolean) => {
    if (!selectedUserId) return;
    try {
      setSelectedUser(await adminBlockUser(selectedUserId, blocked, reason));
      await loadUsers();
    } catch (err: any) {
      setMessage(err.message || 'Не удалось изменить блокировку');
    }
  };

  return (
    <section className="flex-1 overflow-hidden bg-[#050505] text-[#A3A3A3] font-mono">
      <div className="h-full flex flex-col">
        <header className="h-16 border-b border-[#333] bg-[#0A0A0A] px-6 flex items-center justify-between shrink-0">
          <button onClick={onBack} className="flex items-center gap-2 text-[#777] hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold">Назад</span>
          </button>
          <div className="flex items-center gap-2 text-white uppercase font-bold tracking-widest">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            Админка балансов
          </div>
        </header>

        <main className="flex-1 overflow-hidden grid gap-0 lg:grid-cols-[360px_1fr]">
          <aside className="border-r border-[#333] bg-[#080808] overflow-y-auto">
            <div className="p-4 border-b border-[#222]">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-[#111] border border-[#222] p-2 text-xs"
                  placeholder="Пользователь"
                />
                <button onClick={() => loadUsers(query)} className="px-3 border border-[#333] text-[#777] hover:text-white">
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            {message && <div className="m-4 border border-orange-900/60 bg-orange-950/20 p-3 text-xs text-orange-200">{message}</div>}
            {isLoading && <div className="m-4 flex items-center gap-2 text-xs"><Loader2 className="w-4 h-4 animate-spin" /> Загрузка...</div>}

            <div className="divide-y divide-[#1a1a1a]">
              {users.map(user => (
                <button
                  key={user.id}
                  onClick={() => selectUser(user.id)}
                  className={`w-full text-left p-4 hover:bg-[#111] ${selectedUserId === user.id ? 'bg-red-950/20' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-white">{user.username}</span>
                    <span className={`text-[10px] uppercase ${user.status === 'blocked' ? 'text-red-400' : 'text-green-400'}`}>{user.status}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#555]">{user.id} · {formatCredits(user.balance)} CR</div>
                </button>
              ))}
            </div>
          </aside>

          <section className="overflow-y-auto p-6 space-y-6">
            {analytics && (
              <div className="grid gap-4 md:grid-cols-4">
                <Metric icon={<BarChart3 className="w-4 h-4" />} title="Деньги" value={`${analytics.revenueRub || 0} ₽`} />
                <Metric icon={<Wallet className="w-4 h-4" />} title="Куплено" value={`${formatCredits(analytics.creditsBought)} CR`} />
                <Metric icon={<Wallet className="w-4 h-4" />} title="Потрачено" value={`${formatCredits(analytics.creditsSpent)} CR`} />
                <Metric icon={<BarChart3 className="w-4 h-4" />} title="Маржа" value={`${analytics.estimatedMarginRub || 0} ₽`} />
              </div>
            )}

            {selectedUser ? (
              <>
                <div className="border border-[#333] bg-[#0A0A0A] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[#555]">Пользователь</div>
                      <h2 className="mt-1 text-xl font-bold text-white">{selectedUser.summary.username}</h2>
                      <div className="mt-1 text-xs text-[#777]">{selectedUser.summary.userId} · {selectedUser.summary.activePlan}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-widest text-[#555]">Доступно</div>
                      <div className="mt-1 text-xl font-bold text-green-400">{formatCredits(selectedUser.summary.availableCredits)} CR</div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto_auto]">
                    <input value={amount} onChange={e => setAmount(e.target.value)} type="number" className="bg-[#111] border border-[#222] p-2 text-xs" placeholder="Сумма" />
                    <input value={reason} onChange={e => setReason(e.target.value)} className="bg-[#111] border border-[#222] p-2 text-xs" placeholder="Причина" />
                    <button onClick={() => handleAdjust('credit')} className="px-3 py-2 border border-green-900 text-green-300 text-[10px] uppercase font-bold">Начислить</button>
                    <button onClick={() => handleAdjust('debit')} className="px-3 py-2 border border-red-900 text-red-300 text-[10px] uppercase font-bold">Списать</button>
                    <button onClick={() => handleAdjust('correction')} className="px-3 py-2 border border-orange-900 text-orange-300 text-[10px] uppercase font-bold">Correction</button>
                    <button onClick={() => handleBlock(selectedUser.summary.status !== 'blocked')} className="px-3 py-2 border border-[#333] text-[#777] hover:text-white">
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-2">
                  <History title="Транзакции" rows={selectedUser.transactions?.map((row: any) => ({
                    id: row.id,
                    title: row.description || row.type,
                    meta: `${row.type} · ${new Date(row.created_at).toLocaleString('ru-RU')}`,
                    value: `${row.amount > 0 ? '+' : ''}${formatCredits(row.amount)} CR`,
                  })) || []} />
                  <History title="AI-запросы" rows={selectedUser.aiRequests?.map((row: any) => ({
                    id: row.id,
                    title: `${row.kind} / ${row.model}`,
                    meta: `${row.provider} · ${row.status}`,
                    value: `${formatCredits(row.actual_credits || row.estimated_credits)} CR`,
                  })) || []} />
                </div>
              </>
            ) : (
              <div className="border border-dashed border-[#333] p-10 text-center text-xs text-[#555] uppercase tracking-widest">
                Выберите пользователя слева
              </div>
            )}
          </section>
        </main>
      </div>
    </section>
  );
}

function Metric({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="border border-[#333] bg-[#0A0A0A] p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#555]">{icon}{title}</div>
      <div className="mt-2 text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function History({ title, rows }: { title: string; rows: Array<{ id: string; title: string; meta: string; value: string }> }) {
  return (
    <section className="border border-[#333] bg-[#0A0A0A]">
      <div className="border-b border-[#222] px-4 py-3 text-xs uppercase tracking-widest text-white">{title}</div>
      <div className="divide-y divide-[#1a1a1a]">
        {rows.length === 0 ? <div className="p-6 text-xs text-[#555]">Нет данных</div> : rows.map(row => (
          <div key={row.id} className="flex items-center justify-between gap-4 p-4 text-xs">
            <div className="min-w-0">
              <div className="truncate text-[#E0E0E0]">{row.title}</div>
              <div className="mt-1 truncate text-[10px] text-[#555]">{row.meta}</div>
            </div>
            <div className="shrink-0 text-white font-bold">{row.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
