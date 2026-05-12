import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, CreditCard, Database, KeyRound, Loader2, Plus, Shield, Trash2, Wallet } from 'lucide-react';
import {
  claimDailyBonus,
  cancelSubscription,
  changeSubscription,
  clearSessionByokKey,
  createYooKassaPayment,
  deleteStoredByok,
  fetchAiRequests,
  fetchBillingPackages,
  fetchBillingSummary,
  fetchStoredByokKeys,
  fetchSubscriptionPlans,
  fetchTransactions,
  saveStoredByok,
  setSessionByokKey,
  type AiRequestRow,
  type BillingPackage,
  type BillingSummary,
  type ByokKey,
  type LedgerEntry,
  type SubscriptionPlan,
} from '../lib/billing';

interface BalanceScreenProps {
  onBack: () => void;
  onSummaryChange: (summary: BillingSummary) => void;
}

const formatCredits = (value = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
const formatDate = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : '—';

export function BalanceScreen({ onBack, onSummaryChange }: BalanceScreenProps) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [transactions, setTransactions] = useState<LedgerEntry[]>([]);
  const [aiRequests, setAiRequests] = useState<AiRequestRow[]>([]);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [byokKeys, setByokKeys] = useState<ByokKey[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'income' | 'spend' | 'ai' | 'byok'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'openai' | 'openrouter'>('openrouter');
  const [sessionKey, setSessionKey] = useState('');
  const [storedKey, setStoredKey] = useState('');
  const [storedLimit, setStoredLimit] = useState('');

  const load = async () => {
    setIsLoading(true);
    try {
      const [nextSummary, nextTransactions, nextAiRequests, nextPackages, nextKeys, nextPlans] = await Promise.all([
        fetchBillingSummary(),
        fetchTransactions(),
        fetchAiRequests(),
        fetchBillingPackages(),
        fetchStoredByokKeys(),
        fetchSubscriptionPlans(),
      ]);
      setSummary(nextSummary);
      setTransactions(nextTransactions);
      setAiRequests(nextAiRequests);
      setPackages(nextPackages);
      setByokKeys(nextKeys);
      setPlans(nextPlans);
      onSummaryChange(nextSummary);
    } catch (err: any) {
      setMessage(err.message || 'Не удалось загрузить баланс');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredTransactions = useMemo(() => {
    if (activeTab === 'income') return transactions.filter(row => row.amount > 0);
    if (activeTab === 'spend') return transactions.filter(row => row.amount < 0 || row.type === 'reserve' || row.type === 'release');
    return transactions;
  }, [transactions, activeTab]);

  const handleBuy = async (packageId: string) => {
    setMessage('');
    try {
      const payment = await createYooKassaPayment(packageId);
      if (payment.confirmationUrl) {
        window.location.href = payment.confirmationUrl;
      } else {
        setMessage('Платеж создан, но ЮKassa не вернула ссылку на оплату.');
      }
    } catch (err: any) {
      setMessage(err.message || 'Не удалось создать платеж');
    }
  };

  const handleDailyBonus = async () => {
    try {
      const nextSummary = await claimDailyBonus();
      setSummary(nextSummary);
      onSummaryChange(nextSummary);
      setMessage('Ежедневные кредиты начислены.');
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Бонус недоступен');
    }
  };

  const handlePlan = async (plan: string) => {
    try {
      const nextSummary = plan === 'Free' ? await cancelSubscription() : await changeSubscription(plan);
      setSummary(nextSummary);
      onSummaryChange(nextSummary);
      setMessage(plan === 'Free' ? 'Подписка отменена, активен Free.' : `Тариф ${plan} активирован.`);
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Не удалось изменить тариф');
    }
  };

  const handleSessionByok = async () => {
    try {
      const result = await setSessionByokKey(provider, sessionKey);
      setSessionKey('');
      setMessage(`Ключ ${result.key.mask} активен до выхода из аккаунта.`);
    } catch (err: any) {
      setMessage(err.message || 'Не удалось подключить ключ');
    }
  };

  const handleStoredByok = async () => {
    try {
      const nextKeys = await saveStoredByok(provider, storedKey, storedLimit ? Number(storedLimit) : undefined);
      setStoredKey('');
      setStoredLimit('');
      setByokKeys(nextKeys);
      setMessage('Ключ сохранен в зашифрованном виде.');
    } catch (err: any) {
      setMessage(err.message || 'Не удалось сохранить ключ');
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
            <Wallet className="w-4 h-4 text-green-500" />
            Баланс и кредиты
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-[#777] text-xs uppercase">
              <Loader2 className="w-4 h-4 animate-spin" />
              Загрузка финансового журнала...
            </div>
          )}

          {message && (
            <div className="border border-orange-900/60 bg-orange-950/20 px-4 py-3 text-xs text-orange-200">
              {message}
            </div>
          )}

          {summary && (
            <div className="grid gap-4 md:grid-cols-4">
              <Metric title="Доступно" value={`${formatCredits(summary.availableCredits)} CR`} accent="text-green-400" />
              <Metric title="Зарезервировано" value={`${formatCredits(summary.reservedCredits)} CR`} accent="text-orange-400" />
              <Metric title="Всего осталось" value={`${formatCredits(summary.balanceCredits)} CR`} accent="text-white" />
              <Metric title="Потрачено" value={`${formatCredits(summary.spentCredits)} CR`} accent="text-red-400" />
            </div>
          )}

          {summary?.lowBalance && (
            <div className="border border-red-900 bg-red-950/20 px-4 py-3 text-xs text-red-200 uppercase tracking-wider">
              Низкий баланс: осталось меньше {formatCredits(summary.lowBalanceThreshold)} кредитов.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {packages.map(pack => (
              <button
                key={pack.id}
                onClick={() => handleBuy(pack.id)}
                className="text-left border border-[#333] bg-[#0A0A0A] p-4 hover:border-green-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <CreditCard className="w-5 h-5 text-green-500" />
                  <span className="text-white font-bold">{pack.amountRub} ₽</span>
                </div>
                <div className="mt-4 text-sm font-bold text-white uppercase">{pack.name}</div>
                <div className="mt-1 text-xs text-[#777]">{formatCredits(pack.credits)} кредитов</div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map(plan => (
              <button
                key={plan.id}
                onClick={() => handlePlan(plan.id)}
                className={`text-left border p-4 transition-colors ${
                  summary?.activePlan === plan.id
                    ? 'border-cyan-700 bg-cyan-950/20'
                    : 'border-[#333] bg-[#0A0A0A] hover:border-cyan-900'
                }`}
              >
                <div className="text-sm font-bold text-white uppercase">{plan.name}</div>
                <div className="mt-2 text-xs text-[#777]">{formatCredits(plan.monthlyCredits)} кредитов в месяц</div>
                <div className="mt-1 text-[10px] uppercase text-cyan-300">Модели: {plan.modelLimit}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 border-b border-[#222] pb-3">
            {[
              ['all', 'Все операции'],
              ['income', 'Пополнения'],
              ['spend', 'Списания'],
              ['ai', 'AI-запросы'],
              ['byok', 'BYOK'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`px-3 py-2 text-[10px] uppercase font-bold border transition-colors ${
                  activeTab === id ? 'bg-red-950 border-red-700 text-red-200' : 'bg-[#0A0A0A] border-[#222] text-[#777] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={handleDailyBonus}
              className="ml-auto flex items-center gap-2 px-3 py-2 text-[10px] uppercase font-bold border border-green-900/70 text-green-300 bg-green-950/20 hover:bg-green-900/30"
            >
              <Plus className="w-3 h-3" />
              Ежедневные кредиты
            </button>
          </div>

          {activeTab === 'ai' ? (
            <DataList icon={<Database className="w-4 h-4" />} empty="AI-запросов пока нет">
              {aiRequests.map(row => (
                <ListRow
                  key={row.id}
                  title={`${row.kind} / ${row.model}`}
                  meta={`${row.provider} · ${row.status} · ${formatDate(row.created_at)} · ${row.pricing_version_id || 'pricing_v1'}`}
                  amount={`-${formatCredits(row.actual_credits || row.estimated_credits)} CR`}
                />
              ))}
            </DataList>
          ) : activeTab === 'byok' ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="border border-[#333] bg-[#0A0A0A] p-5 space-y-4">
                <h3 className="text-xs uppercase tracking-widest text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-cyan-400" />
                  Ключ только на сессию
                </h3>
                <ByokControls provider={provider} setProvider={setProvider} />
                <input value={sessionKey} onChange={e => setSessionKey(e.target.value)} type="password" className="w-full bg-[#111] border border-[#222] p-2 text-xs" placeholder="API-ключ" />
                <div className="flex gap-2">
                  <button onClick={handleSessionByok} className="flex-1 py-2 bg-cyan-950/30 border border-cyan-900 text-cyan-200 text-[10px] uppercase font-bold">Использовать</button>
                  <button onClick={() => clearSessionByokKey().then(() => setMessage('Сессионный ключ удален.'))} className="px-3 py-2 border border-[#333] text-[#777] hover:text-white">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </section>

              <section className="border border-[#333] bg-[#0A0A0A] p-5 space-y-4">
                <h3 className="text-xs uppercase tracking-widest text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-400" />
                  Зашифрованное хранение
                </h3>
                <ByokControls provider={provider} setProvider={setProvider} />
                <input value={storedKey} onChange={e => setStoredKey(e.target.value)} type="password" className="w-full bg-[#111] border border-[#222] p-2 text-xs" placeholder="API-ключ" />
                <input value={storedLimit} onChange={e => setStoredLimit(e.target.value)} type="number" className="w-full bg-[#111] border border-[#222] p-2 text-xs" placeholder="Лимит кредитов в месяц" />
                <button onClick={handleStoredByok} className="w-full py-2 bg-green-950/30 border border-green-900 text-green-200 text-[10px] uppercase font-bold">Сохранить ключ</button>
                <div className="space-y-2">
                  {byokKeys.map(key => (
                    <div key={key.id} className="flex items-center justify-between border border-[#222] p-2 text-xs">
                      <span>{key.provider}: {key.key_mask}</span>
                      <button onClick={() => deleteStoredByok(key.provider).then(setByokKeys)} className="text-red-400 hover:text-red-200">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <DataList icon={<Wallet className="w-4 h-4" />} empty="Операций пока нет">
              {filteredTransactions.map(row => (
                <ListRow
                  key={row.id}
                  title={row.description || row.type}
                  meta={`${row.type} · ${row.bucket} · ${formatDate(row.created_at)}`}
                  amount={`${row.amount > 0 ? '+' : ''}${formatCredits(row.amount)} CR`}
                />
              ))}
            </DataList>
          )}
        </main>
      </div>
    </section>
  );
}

function Metric({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div className="border border-[#333] bg-[#0A0A0A] p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#555]">{title}</div>
      <div className={`mt-2 text-xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

function DataList({ icon, empty, children }: { icon: ReactNode; empty: string; children: ReactNode }) {
  return (
    <section className="border border-[#333] bg-[#0A0A0A]">
      <div className="flex items-center gap-2 border-b border-[#222] px-4 py-3 text-xs uppercase tracking-widest text-white">
        {icon}
        История
      </div>
      <div className="divide-y divide-[#1a1a1a]">
        {Array.isArray(children) && children.length === 0 ? <div className="p-6 text-xs text-[#555]">{empty}</div> : children}
      </div>
    </section>
  );
}

function ListRow({ title, meta, amount }: { title: string; meta: string; amount: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
      <div className="min-w-0">
        <div className="truncate text-[#E0E0E0]">{title}</div>
        <div className="mt-1 truncate text-[10px] uppercase text-[#555]">{meta}</div>
      </div>
      <div className="shrink-0 font-bold text-white">{amount}</div>
    </div>
  );
}

function ByokControls({ provider, setProvider }: { provider: string; setProvider: (provider: any) => void }) {
  return (
    <select value={provider} onChange={e => setProvider(e.target.value)} className="w-full bg-[#111] border border-[#222] p-2 text-xs">
      <option value="openrouter">OpenRouter</option>
      <option value="openai">OpenAI</option>
      <option value="gemini">Gemini</option>
    </select>
  );
}
