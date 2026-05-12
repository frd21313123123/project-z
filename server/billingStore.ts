import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  actualAiCostCredits,
  estimateAiCostCredits,
  type AiBilling,
  type AiBillingReservation,
  type BillableAiActual,
  type BillableAiRequest,
} from './aiBilling';

type Row = Record<string, any>;

interface InitOptions {
  dataDir: string;
  usersFile: string;
  defaultCredits: number;
}

interface PaymentPackage {
  id: string;
  name: string;
  credits: number;
  amountRub: number;
}

let db: DatabaseSync;
let options: InitOptions;

const LOW_BALANCE_CREDITS = envNumber('LOW_BALANCE_CREDITS', 10);
const AI_PER_MINUTE_LIMIT = envNumber('AI_REQUESTS_PER_MINUTE', 20, 1);
const AI_PER_DAY_LIMIT = envNumber('AI_REQUESTS_PER_DAY', 200, 1);
const PAYMENT_ATTEMPTS_PER_DAY = envNumber('PAYMENT_ATTEMPTS_PER_DAY', 20, 1);
const BONUS_CLAIMS_PER_DAY = envNumber('BONUS_CLAIMS_PER_DAY', 1, 1);
const DEFAULT_PLAN = 'Free';

const DEFAULT_PACKAGES: PaymentPackage[] = [
  { id: 'starter', name: 'Стартовый пакет', credits: 100, amountRub: 199 },
  { id: 'plus', name: 'Большой пакет', credits: 600, amountRub: 999 },
  { id: 'pro', name: 'Максимальный пакет', credits: 1500, amountRub: 1990 },
];

const SUBSCRIPTION_PLANS = [
  { id: 'Free', name: 'Free', monthlyCredits: 0, modelLimit: 'экономный' },
  { id: 'Plus', name: 'Plus', monthlyCredits: 500, modelLimit: 'обычный' },
  { id: 'Pro', name: 'Pro', monthlyCredits: 1500, modelLimit: 'максимальный' },
];

function envNumber(name: string, fallback: number, min = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function roundCredits(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function adminNames() {
  return new Set(
    (process.env.ADMIN_USERNAMES || '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean)
  );
}

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getOne<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function getAll<T = Row>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function run(sql: string, ...params: any[]) {
  db.prepare(sql).run(...params);
}

export function initBillingStore(initOptions: InitOptions) {
  options = initOptions;
  fs.mkdirSync(options.dataDir, { recursive: true });
  const dbPath = path.join(options.dataDir, 'billing.sqlite');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  createSchema();
  seedStaticData();
  migrateJsonUsers();
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      currency TEXT NOT NULL DEFAULT 'credits',
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      bucket TEXT NOT NULL DEFAULT 'purchased',
      description TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      related_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      request_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ai_requests (
      id TEXT PRIMARY KEY,
      reservation_id TEXT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      estimated_credits REAL NOT NULL DEFAULT 0,
      actual_credits REAL NOT NULL DEFAULT 0,
      pricing_version_id TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      provider_cost_usd REAL,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_payment_id TEXT,
      package_id TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_rub REAL NOT NULL,
      credits REAL NOT NULL,
      idempotence_key TEXT NOT NULL UNIQUE,
      confirmation_url TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      credited_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      provider_refund_id TEXT,
      status TEXT NOT NULL,
      amount_rub REAL NOT NULL,
      credits_to_debit REAL NOT NULL,
      idempotence_key TEXT NOT NULL UNIQUE,
      reason TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS processed_provider_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY(provider, event_id)
    );

    CREATE TABLE IF NOT EXISTS pricing_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credit_usd REAL NOT NULL,
      markup_percent REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      input_usd_per_1m REAL,
      output_usd_per_1m REAL,
      image_usd REAL,
      game_mode TEXT,
      game_action TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      pricing_version_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      credits REAL NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bonus_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      credits REAL NOT NULL,
      expires_at TEXT,
      claimed_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      monthly_credits REAL NOT NULL,
      renews_at TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      target_user_id TEXT,
      action TEXT NOT NULL,
      amount REAL,
      reason TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS byok_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      key_ciphertext TEXT NOT NULL,
      key_iv TEXT NOT NULL,
      key_tag TEXT NOT NULL,
      key_mask TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      monthly_limit_credits REAL,
      spent_this_month_credits REAL NOT NULL DEFAULT 0,
      month_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS ledger_user_created_idx ON ledger_entries(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_requests_user_created_idx ON ai_requests(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS payments_provider_id_idx ON payments(provider, provider_payment_id);
    CREATE INDEX IF NOT EXISTS reservations_active_idx ON credit_reservations(user_id, status);
  `);
}

function seedStaticData() {
  const version = getOne('SELECT id FROM pricing_versions WHERE active = 1');
  if (!version) {
    run(
      `INSERT INTO pricing_versions (id, name, credit_usd, markup_percent, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      'pricing_v1',
      'Default v1',
      envNumber('AI_CREDIT_USD', 0.01, 0.000001),
      envNumber('AI_MARKUP_PERCENT', 30),
      nowIso()
    );
  }

  const modelCount = getOne<{ count: number }>('SELECT COUNT(*) AS count FROM models')?.count || 0;
  if (modelCount === 0) {
    const rows = [
      ['gemini-3.1-pro-preview', 'gemini', 'text', 2, 12, null, 'умный', 'simulation'],
      ['gemini-2.5-flash', 'gemini', 'text', 0.3, 2.5, null, 'экономный', 'simulation'],
      ['gpt-5.5', 'openai', 'text', 3, 15, null, 'максимальный', 'simulation'],
      ['anthropic/claude-3.5-sonnet', 'openrouter', 'text', 3, 15, null, 'умный', 'simulation'],
      ['imagen-3.0-generate-002', 'gemini', 'image', null, null, 0.04, 'обычный', 'image'],
      ['dall-e-3', 'openai', 'image', null, null, 0.08, 'максимальный', 'image'],
    ];
    for (const row of rows) {
      run(
        `INSERT INTO models
         (id, provider, kind, input_usd_per_1m, output_usd_per_1m, image_usd, game_mode, game_action, pricing_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pricing_v1')`,
        ...row
      );
    }
  }
}

function migrateJsonUsers() {
  const rawUsers = readJsonUsers();
  const configuredAdmins = adminNames();
  for (const [key, rawUser] of Object.entries(rawUsers)) {
    const user = rawUser as any;
    const username = String(user.username || key);
    const userId = key.toLowerCase();
    ensureBillingUser(userId, username);
    if (configuredAdmins.has(userId)) {
      run(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`, nowIso(), userId);
    }

    const ledgerCount = getOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ledger_entries WHERE user_id = ?`,
      userId
    )?.count || 0;
    if (ledgerCount === 0) {
      const initialCredits = Number.isFinite(Number(user.aiBalanceCredits))
        ? Number(user.aiBalanceCredits)
        : options.defaultCredits;
      addLedgerEntry({
        userId,
        type: 'bonus_grant',
        amount: roundCredits(initialCredits),
        bucket: 'bonus',
        description: 'Стартовый или мигрированный баланс',
        relatedId: 'json_migration',
        metadata: { source: 'json_user_profile' },
      });
      ensureDefaultSubscription(userId);
    }

    const reservations = user.aiReservations && typeof user.aiReservations === 'object'
      ? user.aiReservations
      : {};
    for (const [reservationId, reservation] of Object.entries(reservations)) {
      const exists = getOne(`SELECT id FROM credit_reservations WHERE id = ?`, reservationId);
      if (!exists) {
        const r = reservation as any;
        run(
          `INSERT INTO credit_reservations
           (id, user_id, amount, status, provider, model, kind, request_json, created_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          reservationId,
          userId,
          Number(r.amount) || 0,
          r.provider || 'gemini',
          r.model || 'unknown',
          r.kind || 'text',
          json(r),
          r.createdAt || nowIso()
        );
      }
    }
  }
}

function readJsonUsers() {
  try {
    if (!fs.existsSync(options.usersFile)) return {};
    return JSON.parse(fs.readFileSync(options.usersFile, 'utf-8')) || {};
  } catch {
    return {};
  }
}

export function ensureBillingUser(userId: string, displayName?: string) {
  const idValue = userId.toLowerCase();
  const existing = getOne<Row>(`SELECT id FROM users WHERE id = ?`, idValue);
  const role = adminNames().has(idValue) ? 'admin' : 'user';
  if (!existing) {
    run(
      `INSERT INTO users (id, username, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      idValue,
      displayName || userId,
      role,
      nowIso(),
      nowIso()
    );
    run(`INSERT INTO wallets (user_id, created_at) VALUES (?, ?)`, idValue, nowIso());
    addLedgerEntry({
      userId: idValue,
      type: 'bonus_grant',
      amount: roundCredits(options.defaultCredits),
      bucket: 'bonus',
      description: 'Стартовые кредиты',
      relatedId: 'registration',
      metadata: { source: 'registration' },
    });
    ensureDefaultSubscription(idValue);
    return;
  }
  run(
    `UPDATE users SET username = COALESCE(?, username), role = CASE WHEN ? = 'admin' THEN 'admin' ELSE role END, updated_at = ? WHERE id = ?`,
    displayName || userId,
    role,
    nowIso(),
    idValue
  );
  run(`INSERT OR IGNORE INTO wallets (user_id, created_at) VALUES (?, ?)`, idValue, nowIso());
}

function ensureDefaultSubscription(userId: string) {
  const active = getOne(`SELECT id FROM subscriptions WHERE user_id = ? AND status = 'active'`, userId);
  if (active) return;
  run(
    `INSERT INTO subscriptions (id, user_id, plan, status, monthly_credits, renews_at, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 0, NULL, ?, ?)`,
    id('sub'),
    userId,
    DEFAULT_PLAN,
    nowIso(),
    nowIso()
  );
}

function addLedgerEntry(input: {
  userId: string;
  type: string;
  amount: number;
  bucket?: string;
  description?: string;
  metadata?: unknown;
  relatedId?: string;
  createdBy?: string;
}) {
  run(
    `INSERT INTO ledger_entries
     (id, user_id, type, amount, bucket, description, metadata_json, related_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id('ledger'),
    input.userId,
    input.type,
    roundCredits(input.amount),
    input.bucket || 'purchased',
    input.description || null,
    json(input.metadata),
    input.relatedId || null,
    input.createdBy || null,
    nowIso()
  );
}

export function getBillingUser(userId: string) {
  ensureBillingUser(userId);
  return getOne<Row>(`SELECT * FROM users WHERE id = ?`, userId.toLowerCase());
}

export function getBillingSummary(userId: string) {
  ensureBillingUser(userId);
  const user = getBillingUser(userId)!;
  const balance = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE user_id = ?`,
    user.id
  )?.total || 0);
  const reserved = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM credit_reservations WHERE user_id = ? AND status = 'active'`,
    user.id
  )?.total || 0);
  const spent = Math.abs(Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE user_id = ? AND amount < 0`,
    user.id
  )?.total || 0));
  const purchased = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE user_id = ? AND bucket = 'purchased'`,
    user.id
  )?.total || 0);
  const bonus = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE user_id = ? AND bucket = 'bonus'`,
    user.id
  )?.total || 0);
  const subscription = getOne<Row>(
    `SELECT plan, status, monthly_credits, renews_at FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    user.id
  );
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    isAdmin: user.role === 'admin',
    status: user.status,
    blockedReason: user.blocked_reason,
    balanceCredits: roundCredits(balance),
    reservedCredits: roundCredits(reserved),
    availableCredits: roundCredits(balance - reserved),
    spentCredits: roundCredits(spent),
    purchasedCredits: roundCredits(purchased),
    bonusCredits: roundCredits(bonus),
    lowBalance: balance - reserved <= LOW_BALANCE_CREDITS,
    lowBalanceThreshold: LOW_BALANCE_CREDITS,
    activePlan: subscription?.plan || DEFAULT_PLAN,
    subscription,
  };
}

export function listTransactions(userId: string, input: { type?: string; cursor?: string; limit?: number } = {}) {
  ensureBillingUser(userId);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const params: any[] = [userId.toLowerCase()];
  let where = `WHERE user_id = ?`;
  if (input.type) {
    where += ` AND type = ?`;
    params.push(input.type);
  }
  if (input.cursor) {
    where += ` AND created_at < ?`;
    params.push(input.cursor);
  }
  params.push(limit);
  return getAll<Row>(
    `SELECT * FROM ledger_entries ${where} ORDER BY created_at DESC LIMIT ?`,
    ...params
  ).map(row => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
}

export function listAiRequests(userId: string, limit = 50) {
  ensureBillingUser(userId);
  return getAll<Row>(
    `SELECT * FROM ai_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId.toLowerCase(),
    Math.min(Math.max(Number(limit) || 50, 1), 100)
  );
}

export function listPackages() {
  return DEFAULT_PACKAGES.map(pack => ({ ...pack, currency: 'RUB' }));
}

export function listSubscriptionPlans() {
  return SUBSCRIPTION_PLANS;
}

export function changeSubscription(userIdInput: string, planId: string) {
  const plan = SUBSCRIPTION_PLANS.find(item => item.id === planId);
  if (!plan) throw httpError(404, 'Тариф не найден');
  const userId = userIdInput.toLowerCase();
  transaction(() => {
    ensureBillingUser(userId);
    run(
      `UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ?
       WHERE user_id = ? AND status = 'active'`,
      nowIso(),
      nowIso(),
      userId
    );
    const subscriptionId = id('sub');
    run(
      `INSERT INTO subscriptions (id, user_id, plan, status, monthly_credits, renews_at, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      subscriptionId,
      userId,
      plan.id,
      plan.monthlyCredits,
      new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      nowIso(),
      nowIso()
    );
    if (plan.monthlyCredits > 0) {
      addLedgerEntry({
        userId,
        type: 'subscription_grant',
        amount: plan.monthlyCredits,
        bucket: 'bonus',
        description: `Ежемесячные кредиты тарифа ${plan.id}`,
        relatedId: subscriptionId,
      });
    }
  });
  return getBillingSummary(userId);
}

export function cancelSubscription(userIdInput: string) {
  const userId = userIdInput.toLowerCase();
  transaction(() => {
    ensureBillingUser(userId);
    run(
      `UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ?
       WHERE user_id = ? AND status = 'active' AND plan <> 'Free'`,
      nowIso(),
      nowIso(),
      userId
    );
    ensureDefaultSubscription(userId);
  });
  return getBillingSummary(userId);
}

function getPackage(packageId: string) {
  const pack = DEFAULT_PACKAGES.find(item => item.id === packageId);
  if (!pack) throw httpError(404, 'Пакет кредитов не найден');
  return pack;
}

export function createAiBilling(userId: string): AiBilling {
  return {
    async reserve(request) {
      return reserveAiCredits(userId, request);
    },
    async run<T>(request, task) {
      const reservation = reserveAiCredits(userId, request);
      try {
        const outcome = await task();
        await reservation.settle(outcome);
        return outcome.result as T;
      } catch (err: any) {
        await reservation.refund(err?.message);
        throw err;
      }
    },
  };
}

function reserveAiCredits(userIdInput: string, request: BillableAiRequest): AiBillingReservation & { refund(error?: string): Promise<void> } {
  const userId = userIdInput.toLowerCase();
  const pricingVersionId = activePricingVersionId();
  const estimatedCredits = estimateAiCostCredits(request);
  const reservationId = id('reserve');
  const aiRequestId = id('ai');

  transaction(() => {
    ensureBillingUser(userId);
    const user = getBillingUser(userId)!;
    if (user.status === 'blocked') throw httpError(403, user.blocked_reason || 'Пользователь заблокирован');
    checkRateLimit(userId, 'ai_minute', 60_000, AI_PER_MINUTE_LIMIT);
    checkRateLimit(userId, 'ai_day', 24 * 60 * 60_000, AI_PER_DAY_LIMIT);

    const summary = getBillingSummary(userId);
    if (summary.availableCredits < estimatedCredits) {
      throw httpError(
        402,
        `Не хватает кредитов. Нужно примерно ${estimatedCredits}, доступно ${Math.max(0, summary.availableCredits)}.`
      );
    }

    run(
      `INSERT INTO credit_reservations
       (id, user_id, amount, status, provider, model, kind, request_json, created_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      reservationId,
      userId,
      estimatedCredits,
      request.provider,
      request.model,
      request.kind,
      json(request),
      nowIso()
    );
    run(
      `INSERT INTO ai_requests
       (id, reservation_id, user_id, provider, model, kind, status, estimated_credits, pricing_version_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
      aiRequestId,
      reservationId,
      userId,
      request.provider,
      request.model,
      request.kind,
      estimatedCredits,
      pricingVersionId,
      nowIso()
    );
    addLedgerEntry({
      userId,
      type: 'reserve',
      amount: 0,
      description: 'Резерв AI-кредитов',
      relatedId: reservationId,
      metadata: { estimatedCredits, request },
    });
  });

  let closed = false;
  const close = async (actual?: BillableAiActual, error?: string) => {
    if (closed) return;
    closed = true;
    transaction(() => {
      const reservation = getOne<Row>(
        `SELECT * FROM credit_reservations WHERE id = ? AND status = 'active'`,
        reservationId
      );
      if (!reservation) return;
      run(
        `UPDATE credit_reservations SET status = ?, settled_at = ? WHERE id = ?`,
        actual ? 'settled' : 'released',
        nowIso(),
        reservationId
      );
      if (actual) {
        const actualCredits = actualAiCostCredits(request, actual);
        addLedgerEntry({
          userId,
          type: 'ai_debit',
          amount: -actualCredits,
          bucket: 'purchased',
          description: `AI-запрос: ${request.kind} / ${request.model}`,
          relatedId: aiRequestId,
          metadata: { request, actual, estimatedCredits },
        });
        run(
          `UPDATE ai_requests
           SET status = 'succeeded', actual_credits = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?,
               provider_cost_usd = ?, finished_at = ?
           WHERE id = ?`,
          actualCredits,
          actual.inputTokens || null,
          actual.outputTokens || null,
          actual.totalTokens || null,
          actual.providerCostUsd || null,
          nowIso(),
          aiRequestId
        );
      } else {
        addLedgerEntry({
          userId,
          type: 'release',
          amount: 0,
          description: 'Освобождение резерва AI-кредитов',
          relatedId: reservationId,
          metadata: { estimatedCredits, error },
        });
        run(
          `UPDATE ai_requests SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
          error || null,
          nowIso(),
          aiRequestId
        );
      }
    });
  };

  return {
    estimatedCredits,
    settle: (actual: BillableAiActual) => close(actual),
    refund: (error?: string) => close(undefined, error),
  };
}

function activePricingVersionId() {
  return getOne<Row>(`SELECT id FROM pricing_versions WHERE active = 1 LIMIT 1`)?.id || 'pricing_v1';
}

function checkRateLimit(userId: string, scope: string, windowMs: number, limit: number) {
  const windowStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const key = `${userId}:${scope}:${windowStart}`;
  const current = getOne<Row>(`SELECT count FROM rate_limits WHERE key = ?`, key);
  if (current && Number(current.count) >= limit) {
    throw httpError(429, 'Слишком много действий. Повторите позже.');
  }
  if (current) {
    run(`UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE key = ?`, nowIso(), key);
  } else {
    run(
      `INSERT INTO rate_limits (key, user_id, scope, window_start, count, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      key,
      userId,
      scope,
      windowStart,
      nowIso()
    );
  }
}

export async function createYooKassaPayment(userIdInput: string, packageId: string, returnUrl: string) {
  const userId = userIdInput.toLowerCase();
  const pack = getPackage(packageId);
  const paymentId = id('pay');
  const idempotenceKey = crypto.randomUUID();
  transaction(() => {
    ensureBillingUser(userId);
    checkRateLimit(userId, 'payment_attempt_day', 24 * 60 * 60_000, PAYMENT_ATTEMPTS_PER_DAY);
    run(
      `INSERT INTO payments
       (id, user_id, provider, package_id, status, amount_rub, credits, idempotence_key, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'yookassa', ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      paymentId,
      userId,
      packageId,
      pack.amountRub,
      pack.credits,
      idempotenceKey,
      json({ returnUrl }),
      nowIso(),
      nowIso()
    );
  });

  const credentials = yooCredentials();
  if (!credentials) {
    const mockUrl = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}mockPayment=${paymentId}`;
    run(
      `UPDATE payments SET confirmation_url = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
      mockUrl,
      json({ returnUrl, mock: true, note: 'YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY are not configured' }),
      nowIso(),
      paymentId
    );
    return { paymentId, confirmationUrl: mockUrl, mock: true };
  }

  const response = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      'Authorization': `Basic ${credentials.basic}`,
    },
    body: JSON.stringify({
      amount: { value: pack.amountRub.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description: `${pack.name}: ${pack.credits} кредитов Project Z`,
      metadata: { localPaymentId: paymentId, userId, packageId },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw httpError(response.status, data.description || data.error || 'Ошибка создания платежа');

  run(
    `UPDATE payments
     SET provider_payment_id = ?, status = ?, confirmation_url = ?, metadata_json = ?, updated_at = ?
     WHERE id = ?`,
    data.id,
    data.status || 'pending',
    data.confirmation?.confirmation_url || null,
    json(data),
    nowIso(),
    paymentId
  );
  return { paymentId, providerPaymentId: data.id, confirmationUrl: data.confirmation?.confirmation_url, mock: false };
}

export async function handleYooKassaWebhook(payload: any) {
  const eventType = String(payload?.event || '');
  const object = payload?.object || {};
  const objectId = String(object?.id || '');
  if (!eventType || !objectId) throw httpError(400, 'Некорректный webhook ЮKassa');
  const eventId = `${eventType}:${objectId}:${object.status || 'unknown'}`;

  const alreadyProcessed = transaction(() => {
    const existing = getOne(
      `SELECT event_id FROM processed_provider_events WHERE provider = 'yookassa' AND event_id = ?`,
      eventId
    );
    if (existing) return true;
    run(
      `INSERT INTO processed_provider_events (provider, event_id, event_type, object_id, processed_at)
       VALUES ('yookassa', ?, ?, ?, ?)`,
      eventId,
      eventType,
      objectId,
      nowIso()
    );
    return false;
  });
  if (alreadyProcessed) return { success: true, duplicate: true };

  if (eventType === 'payment.succeeded') {
    const payment = await verifyYooPayment(objectId, object);
    if (payment.status !== 'succeeded') throw httpError(400, 'Платеж ЮKassa не подтвержден как успешный');
    creditSuccessfulPayment(payment);
  } else if (eventType === 'payment.canceled') {
    run(
      `UPDATE payments SET status = 'canceled', metadata_json = ?, updated_at = ? WHERE provider = 'yookassa' AND provider_payment_id = ?`,
      json(object),
      nowIso(),
      objectId
    );
  } else if (eventType === 'refund.succeeded') {
    applyRefundSucceeded(objectId, object);
  }

  return { success: true };
}

async function verifyYooPayment(providerPaymentId: string, fallback: any) {
  const credentials = yooCredentials();
  if (!credentials) return fallback;
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${providerPaymentId}`, {
    headers: { Authorization: `Basic ${credentials.basic}` },
  });
  const data = await response.json();
  if (!response.ok) throw httpError(response.status, data.description || 'Не удалось проверить платеж ЮKassa');
  return data;
}

function creditSuccessfulPayment(providerPayment: any) {
  transaction(() => {
    const localPaymentId = providerPayment?.metadata?.localPaymentId;
    const providerPaymentId = providerPayment?.id;
    const payment = localPaymentId
      ? getOne<Row>(`SELECT * FROM payments WHERE id = ?`, localPaymentId)
      : getOne<Row>(`SELECT * FROM payments WHERE provider = 'yookassa' AND provider_payment_id = ?`, providerPaymentId);
    if (!payment) throw httpError(404, 'Локальный платеж не найден');
    if (payment.credited_at) return;
    const amountRub = Number(providerPayment?.amount?.value || payment.amount_rub);
    if (Math.abs(amountRub - Number(payment.amount_rub)) > 0.01) {
      throw httpError(400, 'Сумма платежа не совпадает с локальным заказом');
    }

    addLedgerEntry({
      userId: payment.user_id,
      type: 'purchase',
      amount: Number(payment.credits),
      bucket: 'purchased',
      description: `Покупка кредитов: ${payment.package_id}`,
      relatedId: payment.id,
      metadata: { provider: 'yookassa', providerPayment },
    });
    run(
      `UPDATE payments
       SET status = 'succeeded', provider_payment_id = COALESCE(provider_payment_id, ?),
           metadata_json = ?, credited_at = ?, updated_at = ?
       WHERE id = ?`,
      providerPaymentId || null,
      json(providerPayment),
      nowIso(),
      nowIso(),
      payment.id
    );
  });
}

export async function createAdminRefund(adminUserId: string, paymentId: string, amountRub?: number, reason?: string) {
  const payment = getOne<Row>(`SELECT * FROM payments WHERE id = ?`, paymentId);
  if (!payment || payment.status !== 'succeeded') throw httpError(404, 'Успешный платеж не найден');
  const refundAmountRub = Math.min(Number(amountRub || payment.amount_rub), Number(payment.amount_rub));
  if (refundAmountRub <= 0) throw httpError(400, 'Сумма возврата должна быть больше 0');
  const creditsToDebit = roundCredits((refundAmountRub / Number(payment.amount_rub)) * Number(payment.credits));
  const refundId = id('refund');
  const idempotenceKey = crypto.randomUUID();
  run(
    `INSERT INTO refunds
     (id, payment_id, status, amount_rub, credits_to_debit, idempotence_key, reason, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    refundId,
    paymentId,
    refundAmountRub,
    creditsToDebit,
    idempotenceKey,
    reason || null,
    nowIso(),
    nowIso()
  );

  const credentials = yooCredentials();
  if (!credentials || !payment.provider_payment_id) {
    applyRefundSucceeded(refundId, { id: refundId, status: 'succeeded', mock: true });
    audit(adminUserId, payment.user_id, 'refund', -creditsToDebit, reason, { paymentId, refundId, mock: true });
    return { refundId, mock: true };
  }

  const response = await fetch('https://api.yookassa.ru/v3/refunds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      'Authorization': `Basic ${credentials.basic}`,
    },
    body: JSON.stringify({
      payment_id: payment.provider_payment_id,
      amount: { value: refundAmountRub.toFixed(2), currency: 'RUB' },
      description: reason || 'Возврат кредитов Project Z',
    }),
  });
  const data = await response.json();
  if (!response.ok) throw httpError(response.status, data.description || 'Ошибка возврата ЮKassa');
  run(
    `UPDATE refunds SET provider_refund_id = ?, status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
    data.id,
    data.status || 'pending',
    json(data),
    nowIso(),
    refundId
  );
  if (data.status === 'succeeded') {
    applyRefundSucceeded(data.id, data);
  }
  audit(adminUserId, payment.user_id, 'refund', -creditsToDebit, reason, { paymentId, refundId });
  return { refundId, providerRefundId: data.id, status: data.status };
}

function applyRefundSucceeded(refundObjectId: string, object: any) {
  transaction(() => {
    const refund = getOne<Row>(
      `SELECT r.*, p.user_id FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = ? OR r.provider_refund_id = ?`,
      refundObjectId,
      refundObjectId
    );
    if (!refund || refund.status === 'succeeded') return;
    addLedgerEntry({
      userId: refund.user_id,
      type: 'refund_debit',
      amount: -Number(refund.credits_to_debit),
      bucket: 'purchased',
      description: 'Списание кредитов при возврате платежа',
      relatedId: refund.id,
      metadata: { refund: object },
    });
    run(
      `UPDATE refunds SET status = 'succeeded', provider_refund_id = COALESCE(provider_refund_id, ?),
       metadata_json = ?, updated_at = ? WHERE id = ?`,
      object?.id || null,
      json(object),
      nowIso(),
      refund.id
    );
  });
}

function yooCredentials() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secret) return null;
  return { shopId, basic: Buffer.from(`${shopId}:${secret}`).toString('base64') };
}

export function adminSearchUsers(query = '') {
  const needle = `%${query.toLowerCase()}%`;
  return getAll<Row>(
    `SELECT u.*, 
      COALESCE((SELECT SUM(amount) FROM ledger_entries l WHERE l.user_id = u.id), 0) AS balance
     FROM users u
     WHERE lower(u.id) LIKE ? OR lower(u.username) LIKE ?
     ORDER BY u.updated_at DESC
     LIMIT 50`,
    needle,
    needle
  );
}

export function adminUserBilling(userId: string) {
  return {
    summary: getBillingSummary(userId),
    transactions: listTransactions(userId, { limit: 100 }),
    aiRequests: listAiRequests(userId, 100),
  };
}

export function adminAdjustBalance(
  adminUserId: string,
  targetUserId: string,
  type: 'admin_credit' | 'admin_debit' | 'correction',
  amount: number,
  reason?: string
) {
  if (!Number.isFinite(amount) || amount === 0) throw httpError(400, 'Сумма не должна быть равна 0');
  if (type !== 'correction' && amount < 0) throw httpError(400, 'Для ручного начисления или списания укажите положительную сумму');
  const signedAmount = type === 'admin_debit' ? -amount : amount;
  transaction(() => {
    ensureBillingUser(targetUserId);
    addLedgerEntry({
      userId: targetUserId.toLowerCase(),
      type,
      amount: signedAmount,
      bucket: 'purchased',
      description: reason || manualActionLabel(type),
      createdBy: adminUserId,
      metadata: { reason },
    });
    audit(adminUserId, targetUserId, type, signedAmount, reason);
  });
}

function manualActionLabel(type: string) {
  if (type === 'admin_credit') return 'Ручное начисление кредитов';
  if (type === 'admin_debit') return 'Ручное списание кредитов';
  return 'Correction спорной ситуации';
}

export function adminBlockUser(adminUserId: string, targetUserId: string, blocked: boolean, reason?: string) {
  ensureBillingUser(targetUserId);
  run(
    `UPDATE users SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?`,
    blocked ? 'blocked' : 'active',
    blocked ? reason || 'Заблокирован администратором' : null,
    nowIso(),
    targetUserId.toLowerCase()
  );
  audit(adminUserId, targetUserId, blocked ? 'block' : 'unblock', undefined, reason);
}

function audit(adminUserId: string, targetUserId: string | undefined, action: string, amount?: number, reason?: string, metadata?: unknown) {
  run(
    `INSERT INTO admin_audit
     (id, admin_user_id, target_user_id, action, amount, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id('audit'),
    adminUserId.toLowerCase(),
    targetUserId?.toLowerCase() || null,
    action,
    amount ?? null,
    reason || null,
    json(metadata),
    nowIso()
  );
}

export function adminAnalytics() {
  const revenue = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount_rub), 0) AS total FROM payments WHERE status = 'succeeded'`
  )?.total || 0);
  const creditsBought = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE type = 'purchase'`
  )?.total || 0);
  const creditsSpent = Math.abs(Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE type IN ('ai_debit', 'admin_debit', 'refund_debit')`
  )?.total || 0));
  const aiCostUsd = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(provider_cost_usd), 0) AS total FROM ai_requests WHERE status = 'succeeded'`
  )?.total || 0);
  const activeReservations = Number(getOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM credit_reservations WHERE status = 'active'`
  )?.total || 0);
  const paymentErrors = getOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM payments WHERE status IN ('canceled', 'failed')`
  )?.count || 0;
  const aiErrors = getOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ai_requests WHERE status = 'failed'`
  )?.count || 0;
  return {
    revenueRub: revenue,
    creditsBought: roundCredits(creditsBought),
    creditsSpent: roundCredits(creditsSpent),
    aiCostUsd,
    estimatedMarginRub: roundCredits(revenue - aiCostUsd * envNumber('USD_RUB_RATE', 95)),
    activeReservations: roundCredits(activeReservations),
    paymentErrors,
    aiErrors,
  };
}

export function suspiciousUsers() {
  return getAll<Row>(
    `SELECT u.id, u.username, u.status,
      COUNT(a.id) AS ai_requests,
      COALESCE(SUM(a.actual_credits), 0) AS ai_credits,
      COALESCE((SELECT SUM(amount) FROM credit_reservations r WHERE r.user_id = u.id AND r.status = 'active'), 0) AS reserved
     FROM users u
     LEFT JOIN ai_requests a ON a.user_id = u.id AND a.created_at > datetime('now', '-1 day')
     GROUP BY u.id
     HAVING ai_requests > 50 OR reserved > 0
     ORDER BY ai_requests DESC
     LIMIT 50`
  );
}

export function grantDailyBonus(userIdInput: string) {
  const userId = userIdInput.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const existing = getOne(
    `SELECT id FROM bonus_grants WHERE user_id = ? AND source = ? AND claimed_at LIKE ?`,
    userId,
    'daily',
    `${today}%`
  );
  if (existing) throw httpError(429, 'Ежедневные кредиты уже получены');
  transaction(() => {
    ensureBillingUser(userId);
    checkRateLimit(userId, 'bonus_claim_day', 24 * 60 * 60_000, BONUS_CLAIMS_PER_DAY);
    const credits = envNumber('DAILY_BONUS_CREDITS', 5);
    const grantId = id('bonus');
    run(
      `INSERT INTO bonus_grants (id, user_id, source, credits, expires_at, claimed_at)
       VALUES (?, ?, 'daily', ?, ?, ?)`,
      grantId,
      userId,
      credits,
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      nowIso()
    );
    addLedgerEntry({
      userId,
      type: 'bonus_grant',
      amount: credits,
      bucket: 'bonus',
      description: 'Ежедневные кредиты',
      relatedId: grantId,
    });
  });
}

export function saveStoredByokKey(userIdInput: string, provider: string, plainKey: string, monthlyLimitCredits?: number) {
  const encryptionKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!encryptionKey) throw httpError(500, 'BYOK_ENCRYPTION_KEY не задан на сервере');
  if (!plainKey || plainKey.length < 8) throw httpError(400, 'API-ключ слишком короткий');
  const userId = userIdInput.toLowerCase();
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const mask = `••••${plainKey.slice(-4)}`;
  const existing = getOne<Row>(
    `SELECT id FROM byok_keys WHERE user_id = ? AND provider = ?`,
    userId,
    provider
  );
  if (existing) {
    run(
      `UPDATE byok_keys
       SET key_ciphertext = ?, key_iv = ?, key_tag = ?, key_mask = ?, enabled = 1,
           monthly_limit_credits = ?, updated_at = ?
       WHERE id = ?`,
      ciphertext.toString('base64'),
      iv.toString('base64'),
      tag.toString('base64'),
      mask,
      monthlyLimitCredits ?? null,
      nowIso(),
      existing.id
    );
  } else {
    run(
      `INSERT INTO byok_keys
       (id, user_id, provider, key_ciphertext, key_iv, key_tag, key_mask, enabled, monthly_limit_credits, month_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      id('byok'),
      userId,
      provider,
      ciphertext.toString('base64'),
      iv.toString('base64'),
      tag.toString('base64'),
      mask,
      monthlyLimitCredits ?? null,
      new Date().toISOString().slice(0, 7),
      nowIso(),
      nowIso()
    );
  }
  return getStoredByokKeys(userId);
}

export function getStoredByokKeys(userIdInput: string) {
  const userId = userIdInput.toLowerCase();
  return getAll<Row>(
    `SELECT id, provider, key_mask, enabled, monthly_limit_credits, spent_this_month_credits, created_at, updated_at
     FROM byok_keys WHERE user_id = ? ORDER BY updated_at DESC`,
    userId
  );
}

export function updateStoredByokKey(userIdInput: string, provider: string, input: { enabled?: boolean; monthlyLimitCredits?: number }) {
  run(
    `UPDATE byok_keys SET enabled = COALESCE(?, enabled), monthly_limit_credits = COALESCE(?, monthly_limit_credits), updated_at = ?
     WHERE user_id = ? AND provider = ?`,
    typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : null,
    input.monthlyLimitCredits ?? null,
    nowIso(),
    userIdInput.toLowerCase(),
    provider
  );
  return getStoredByokKeys(userIdInput);
}

export function deleteStoredByokKey(userIdInput: string, provider: string) {
  run(`DELETE FROM byok_keys WHERE user_id = ? AND provider = ?`, userIdInput.toLowerCase(), provider);
  return getStoredByokKeys(userIdInput);
}

export function decryptStoredByokKey(userIdInput: string, provider: string) {
  const encryptionKey = process.env.BYOK_ENCRYPTION_KEY;
  if (!encryptionKey) return undefined;
  const row = getOne<Row>(
    `SELECT * FROM byok_keys WHERE user_id = ? AND provider = ? AND enabled = 1`,
    userIdInput.toLowerCase(),
    provider
  );
  if (!row) return undefined;
  if (row.monthly_limit_credits !== null && Number(row.spent_this_month_credits) >= Number(row.monthly_limit_credits)) {
    throw httpError(402, 'Лимит расходов сохраненного BYOK-ключа исчерпан');
  }
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(row.key_iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(row.key_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.key_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}
