import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  adminAdjustBalance,
  adminAnalytics,
  adminBlockUser,
  adminSearchUsers,
  adminUserBilling,
  cancelSubscription,
  changeSubscription,
  createAdminRefund,
  createAiBilling,
  createYooKassaPayment,
  decryptStoredByokKey,
  deleteStoredByokKey,
  ensureBillingUser,
  getBillingSummary,
  getBillingUser,
  getStoredByokKeys,
  grantDailyBonus,
  handleYooKassaWebhook,
  httpError,
  initBillingStore,
  listAiRequests,
  listPackages,
  listSubscriptionPlans,
  listTransactions,
  saveStoredByokKey,
  suspiciousUsers,
  updateStoredByokKey,
} from './billingStore';
import { noopAiBilling } from './aiBilling';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DEFAULT_AI_BALANCE_CREDITS = Number(process.env.DEFAULT_AI_BALANCE_CREDITS || '100');

initBillingStore({
  dataDir: DATA_DIR,
  usersFile: USERS_FILE,
  defaultCredits: DEFAULT_AI_BALANCE_CREDITS,
});

// Helper to read/write DB
function getDB(file: string) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error reading ${file}`, e);
  }
  return {};
}

function saveDB(file: string, data: any) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// In-memory sessions (could also use SESSIONS_FILE)
let sessions: Record<string, string> = getDB(SESSIONS_FILE); // token -> username
let loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
let byokSessions: Record<string, { provider: string; key: string; createdAt: string }> = {};

function saveSessions() {
  saveDB(SESSIONS_FILE, sessions);
}

function revokeUserSessions(username: string) {
  const normalizedUsername = username.toLowerCase();
  let changed = false;

  for (const [token, sessionUsername] of Object.entries(sessions)) {
    if (sessionUsername !== normalizedUsername) continue;
    delete sessions[token];
    delete byokSessions[token];
    changed = true;
  }

  if (changed) {
    saveSessions();
  }
}

// PBKDF2 Hashing (Moved from auth.ts)
const PBKDF2_ITERATIONS = 100_000;
function toHex(bytes: Uint8Array) { return Buffer.from(bytes).toString('hex'); }
function fromHex(hex: string) { return Buffer.from(hex, 'hex'); }

async function hashPasswordPBKDF2(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(derivedKey)}`);
    });
  });
}

async function verifyPasswordPBKDF2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHash = parts[3];
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(toHex(derivedKey) === expectedHash);
    });
  });
}

async function verifyLegacyPassword(password: string, storedHash: string): Promise<boolean> {
  const hash = crypto.createHash('sha256').update(password + '_projectz_salt').digest('hex');
  return hash === storedHash;
}

// Auth Middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  const username = sessions[token];
  if (!username) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  (req as any).username = username;
  (req as any).user = getDB(USERS_FILE)[username];
  ensureBillingUser(username, (req as any).user?.username || username);
  const billingUser = getBillingUser(username);
  if (billingUser?.status === 'blocked') {
    delete sessions[token];
    delete byokSessions[token];
    saveSessions();
    return res.status(403).json({
      success: false,
      error: billingUser.blocked_reason || 'Пользователь заблокирован',
    });
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getBillingUser((req as any).username);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Недостаточно прав администратора' });
  }
  next();
}

const DEFAULT_SYMPTOM_PHASES = [
  { id: 'phase1', name: 'Phase I', dayRange: 'D1-2', description: 'Бессимптомная форма.', color: 'blue' },
  { id: 'phase2', name: 'Phase II', dayRange: 'D3-4', description: 'Недомогание, температура.', color: 'yellow' },
  { id: 'phase3', name: 'Phase III', dayRange: 'D5+', description: 'Превращение.', color: 'red' },
];

const DEFAULT_SCENARIO_COUNTERS = [
  {
    id: 'counter_infected',
    key: 'infected',
    label: 'Заражены',
    description: 'Живые люди, зараженные вирусом, но еще не перешедшие в основную форму угрозы.'
  },
  {
    id: 'counter_zombies',
    key: 'zombies',
    label: 'Зомби',
    description: 'Активные превращенные носители, которые уже стали зомби.'
  }
];

const DEFAULT_SCENARIOS = [
  {
    id: 'default_zombie',
    name: 'Базовый: Утечка реагента',
    preface: 'События разворачиваются в наши дни.',
    origin: 'При перевозки секретного реагинета военными автомобиль в который содержал этот реагент попадает в дородную аварию в результате чего происходит утечка этого реагента.',
    symptoms: 'Он крайне таксичный и вызывает болезнь схожую с бешенством, но с нюансом тем, что ему подвержены только люди. Животные могут его переносить, но они не умрут от него. Этот вирус которое вызвает бешенство, после того как пациент дойдет до терминальной стадии когда обычный человек умирает делает из него "Зомби". "Зомби" реагируют на свет и на звуки, при виде других людей они пытаются выпить всю их кровь. Если Зомби укусил человека то здровому человеку в 100% случае передается вирус. Если Зомби только укусил человека, но не убил, то человек заражается вирусом, если Зомби сьедает человека, то человек просто умирает. Передача вируса происходит только через слюну и кровь. Время до перехода человака с момента заражения до терминальной стадии составляет 5 дней. Первые 2 дня вирус протекает в безсимптомной форме. Вирус не может распространяться от человека к человеку если зараженный человек не достиг финальной стадии при которой он превращается в зомби. С 3 по 5 день люди сначала чувствуют легкое недомогание, затем к 4 дню к этому добавляется температура, а к концу 5 дня человек превращается в зомби. Зомби внешне почти не различим от обычного человека за тем исключением, что зомби не ухаживают за собой.',
    counters: DEFAULT_SCENARIO_COUNTERS
  },
  {
    id: 'default_vampire',
    name: 'Вампирский вирус',
    preface: 'Новый вирус долго остается незаметным: у большинства носителей он почти никак не проявляется. Условия старта задает пользователь перед запуском симуляции.',
    origin: 'Вирус попадает в организм человека и обычно не вступает с ним в заметную реакцию. В 96% случаев человек остается зараженным носителем. В 4% случаев вирус запускает превращение в вампира. Вампиры незаметно распространяют вирус рядом с собой, поэтому люди поблизости тоже заражаются.',
    symptoms: 'Вампиры питаются кровью людей. Они могут выпить всю кровь и убить жертву или взять часть крови, оставив человека живым. Вампир может обратить обычного человека, дав ему свою кровь; трансформация занимает 2 дня. Внешне вампиры похожи на обычных людей, но у них абсолютно белая кожа, клыки и красная роговица глаз. Новообращенный вампир слаб: он может только пить кровь, его кожа обугливается на солнце, а долгое воздействие солнечного света может убить его. У вампиров есть потребность в минимальном количестве крови; если норма не выполнена, они теряют силы. Улучшения от чужой крови: 1) повышается сопротивление солнцу, появляется чутье на кровь в пределах 50 метров; 2) появляется превращение в летучую мышь и перелет до 400 метров за раз с большой затратой сил; 3) сопротивление солнцу становится почти полным, появляется способность подчинить одного человека до 1 часа; 4) перелет в форме летучей мыши до 5 км, полная устойчивость к солнечному свету, чутье на людей и кровь до 1 км. Зараженные, но не превращенные люди при встрече с вампиром помогают ему. Вампир первого уровня может контролировать до 10 зараженных людей на неограниченное время, и на каждом новом уровне это количество утраивается. Вампир может пить кровь зараженных, они не сопротивляются, раны быстро заживают, а зараженные не помнят эти события.',
    counters: [
      {
        id: 'counter_infected_vampire',
        key: 'infected',
        label: 'Зараженные',
        description: 'Люди-носители вируса, которые не превратились, но могут помогать вампирам.'
      },
      {
        id: 'counter_vampires',
        key: 'vampires',
        label: 'Вампиры',
        description: 'Превращенные носители вируса с потребностью в крови и растущими способностями.'
      }
    ]
  }
];

const DEFAULT_SETTINGS = {
  textProvider: 'gemini',
  textModel: 'gemini-3.1-pro-preview',
  imageModel: 'imagen-3.0-generate-002',
  imageMode: 'on',
  geminiKey: '',
  openAiKey: '',
  openRouterKey: '',
  showMapOverlay: true,
  symptomPhases: DEFAULT_SYMPTOM_PHASES,
  textScale: 1.0,
  scenarios: DEFAULT_SCENARIOS,
  selectedScenarioId: 'default_zombie',
  mutationPoints: 50,
  mutations: [],
};

function sendError(res: express.Response, err: any) {
  res.status(err.statusCode || 500).json({ success: false, error: err.message });
}

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || username.length < 2) return res.status(400).json({ success: false, error: 'Имя пользователя должно быть не менее 2 символов' });
  if (!password || password.length < 8) return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 8 символов' });

  const users = getDB(USERS_FILE);
  const key = username.toLowerCase();

  if (users[key]) {
    return res.status(400).json({ success: false, error: 'Пользователь с таким именем уже существует' });
  }

  const passwordHash = await hashPasswordPBKDF2(password);
  users[key] = {
    username,
    passwordHash,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: new Date().toISOString(),
  };

  saveDB(USERS_FILE, users);
  ensureBillingUser(key, username);
  
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = key;
  saveSessions();
  
  res.json({ success: true, token, username: users[key].username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Введите имя пользователя и пароль' });

  const key = username.toLowerCase();

  const attempts = loginAttempts.get(key);
  if (attempts && attempts.lockedUntil > Date.now()) {
    const remainingSec = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ success: false, error: `Слишком много попыток. Повторите через ${remainingSec} сек.` });
  }

  const users = getDB(USERS_FILE);
  const user = users[key];

  if (!user) {
    recordFailedAttempt(key);
    return res.status(401).json({ success: false, error: 'Неверное имя пользователя или пароль' });
  }

  let passwordValid = false;
  const isPBKDF2 = user.passwordHash.startsWith('pbkdf2:');

  if (isPBKDF2) {
    passwordValid = await verifyPasswordPBKDF2(password, user.passwordHash);
  } else {
    passwordValid = await verifyLegacyPassword(password, user.passwordHash);
  }

  if (!passwordValid) {
    recordFailedAttempt(key);
    return res.status(401).json({ success: false, error: 'Неверное имя пользователя или пароль' });
  }

  if (!isPBKDF2) {
    user.passwordHash = await hashPasswordPBKDF2(password);
    saveDB(USERS_FILE, users);
  }

  loginAttempts.delete(key);
  ensureBillingUser(key, user.username);

  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = key;
  saveSessions();

  res.json({ success: true, token, username: user.username });
});

function recordFailedAttempt(key: string) {
  const current = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  current.count += 1;
  if (current.count >= 5) {
    current.lockedUntil = Date.now() + 5 * 60 * 1000;
  }
  loginAttempts.set(key, current);
}

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization!.split(' ')[1];
  delete sessions[token];
  delete byokSessions[token];
  saveSessions();
  res.json({ success: true });
});

// --- USER DATA ROUTES ---
app.get('/api/user/me', requireAuth, (req, res) => {
  const username = (req as any).username;
  const users = getDB(USERS_FILE);
  const user = users[username];
  // Return user data without password hash
  const { passwordHash, ...safeUser } = user;
  
  // Merge settings with defaults
  safeUser.settings = { ...DEFAULT_SETTINGS, ...(safeUser.settings || {}) };
  safeUser.settings.geminiKey = '';
  safeUser.settings.openAiKey = '';
  safeUser.settings.openRouterKey = '';
  safeUser.billing = getBillingSummary(username);
  safeUser.aiBalanceCredits = safeUser.billing.balanceCredits;
  safeUser.aiReservedCredits = safeUser.billing.reservedCredits;
  safeUser.aiAvailableCredits = safeUser.billing.availableCredits;
  
  res.json({ success: true, user: safeUser });
});

app.post('/api/user/settings', requireAuth, (req, res) => {
  const username = (req as any).username;
  const users = getDB(USERS_FILE);
  const { geminiKey, openAiKey, openRouterKey, ...safeSettings } = req.body || {};
  users[username].settings = {
    ...safeSettings,
    geminiKey: '',
    openAiKey: '',
    openRouterKey: '',
  };
  saveDB(USERS_FILE, users);
  res.json({ success: true });
});

app.post('/api/user/game', requireAuth, (req, res) => {
  const username = (req as any).username;
  const users = getDB(USERS_FILE);
  users[username].gameSave = req.body;
  saveDB(USERS_FILE, users);
  res.json({ success: true });
});

// --- BILLING ROUTES ---
app.get('/api/billing/summary', requireAuth, (req, res) => {
  res.json({ success: true, summary: getBillingSummary((req as any).username) });
});

app.get('/api/billing/transactions', requireAuth, (req, res) => {
  res.json({
    success: true,
    transactions: listTransactions((req as any).username, {
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: Number(req.query.limit) || 50,
    }),
  });
});

app.get('/api/billing/ai-requests', requireAuth, (req, res) => {
  res.json({ success: true, aiRequests: listAiRequests((req as any).username, Number(req.query.limit) || 50) });
});

app.get('/api/billing/packages', requireAuth, (_req, res) => {
  res.json({ success: true, packages: listPackages() });
});

app.get('/api/billing/subscription-plans', requireAuth, (_req, res) => {
  res.json({ success: true, plans: listSubscriptionPlans() });
});

app.post('/api/billing/subscription', requireAuth, (req, res) => {
  try {
    const summary = changeSubscription((req as any).username, String(req.body?.plan || 'Free'));
    res.json({ success: true, summary });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/billing/subscription/cancel', requireAuth, (req, res) => {
  try {
    const summary = cancelSubscription((req as any).username);
    res.json({ success: true, summary });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/billing/daily-bonus', requireAuth, (req, res) => {
  try {
    grantDailyBonus((req as any).username);
    res.json({ success: true, summary: getBillingSummary((req as any).username) });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/payments/yookassa/create', requireAuth, async (req, res) => {
  try {
    const returnUrl = req.body?.returnUrl || process.env.APP_URL || 'http://localhost:3000';
    const payment = await createYooKassaPayment((req as any).username, req.body?.packageId, returnUrl);
    res.json({ success: true, payment });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/payments/yookassa/webhook', async (req, res) => {
  try {
    const result = await handleYooKassaWebhook(req.body);
    res.json(result);
  } catch (err: any) {
    sendError(res, err);
  }
});

// --- BYOK ROUTES ---
app.get('/api/byok/stored', requireAuth, (req, res) => {
  res.json({ success: true, keys: getStoredByokKeys((req as any).username) });
});

app.post('/api/byok/session', requireAuth, (req, res) => {
  const token = tokenFromReq(req);
  const provider = String(req.body?.provider || '');
  const key = String(req.body?.key || '');
  if (!['gemini', 'openai', 'openrouter'].includes(provider) || key.length < 8) {
    return res.status(400).json({ success: false, error: 'Укажите провайдера и API-ключ' });
  }
  byokSessions[token] = { provider, key, createdAt: new Date().toISOString() };
  res.json({ success: true, key: { provider, mask: `••••${key.slice(-4)}`, stored: false } });
});

app.delete('/api/byok/session', requireAuth, (req, res) => {
  delete byokSessions[tokenFromReq(req)];
  res.json({ success: true });
});

app.post('/api/byok/stored', requireAuth, (req, res) => {
  try {
    const keys = saveStoredByokKey(
      (req as any).username,
      String(req.body?.provider || ''),
      String(req.body?.key || ''),
      req.body?.monthlyLimitCredits === undefined ? undefined : Number(req.body.monthlyLimitCredits)
    );
    res.json({ success: true, keys });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.patch('/api/byok/stored', requireAuth, (req, res) => {
  try {
    const keys = updateStoredByokKey((req as any).username, String(req.body?.provider || ''), {
      enabled: req.body?.enabled,
      monthlyLimitCredits: req.body?.monthlyLimitCredits === undefined ? undefined : Number(req.body.monthlyLimitCredits),
    });
    res.json({ success: true, keys });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.delete('/api/byok/stored', requireAuth, (req, res) => {
  try {
    const keys = deleteStoredByokKey((req as any).username, String(req.body?.provider || req.query.provider || ''));
    res.json({ success: true, keys });
  } catch (err: any) {
    sendError(res, err);
  }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, users: adminSearchUsers(String(req.query.query || '')) });
});

app.get('/api/admin/users/:id/billing', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, user: adminUserBilling(req.params.id) });
});

app.get('/api/admin/users/:id/ai-requests', requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, aiRequests: listAiRequests(req.params.id, 100) });
});

app.post('/api/admin/users/:id/credit', requireAuth, requireAdmin, (req, res) => {
  try {
    adminAdjustBalance((req as any).username, req.params.id, 'admin_credit', Number(req.body?.amount), req.body?.reason);
    res.json({ success: true, user: adminUserBilling(req.params.id) });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/admin/users/:id/debit', requireAuth, requireAdmin, (req, res) => {
  try {
    adminAdjustBalance((req as any).username, req.params.id, 'admin_debit', Number(req.body?.amount), req.body?.reason);
    res.json({ success: true, user: adminUserBilling(req.params.id) });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/admin/users/:id/correction', requireAuth, requireAdmin, (req, res) => {
  try {
    adminAdjustBalance((req as any).username, req.params.id, 'correction', Number(req.body?.amount), req.body?.reason);
    res.json({ success: true, user: adminUserBilling(req.params.id) });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/admin/users/:id/block', requireAuth, requireAdmin, (req, res) => {
  try {
    const shouldBlock = Boolean(req.body?.blocked);
    adminBlockUser((req as any).username, req.params.id, shouldBlock, req.body?.reason);
    if (shouldBlock) {
      revokeUserSessions(req.params.id);
    }
    res.json({ success: true, user: adminUserBilling(req.params.id) });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/admin/payments/:id/refund', requireAuth, requireAdmin, async (req, res) => {
  try {
    const refund = await createAdminRefund((req as any).username, req.params.id, Number(req.body?.amountRub), req.body?.reason);
    res.json({ success: true, refund });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, (_req, res) => {
  res.json({ success: true, analytics: adminAnalytics() });
});

app.get('/api/admin/suspicious-users', requireAuth, requireAdmin, (_req, res) => {
  res.json({ success: true, users: suspiciousUsers() });
});



import { evaluateMutationProposal, generateCityImage, buildCityImagePrompt, simulateOutbreakStepStream } from './gemini';

// --- AI Proxy Routes ---
function tokenFromReq(req: express.Request) {
  return req.headers.authorization?.split(' ')[1] || '';
}

function providerEnvKey(provider: string) {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function sessionByokKey(token: string, provider: string) {
  const session = byokSessions[token];
  if (!session || session.provider !== provider) return undefined;
  return session.key;
}

function resolveProviderKey(username: string, token: string, provider: string, legacyKey?: string) {
  const sessionKey = sessionByokKey(token, provider);
  if (sessionKey) return { key: sessionKey, usingByok: true };
  const storedKey = decryptStoredByokKey(username, provider);
  if (storedKey) return { key: storedKey, usingByok: true };
  return { key: legacyKey || providerEnvKey(provider), usingByok: false };
}

function getApiMeta(user: any, username: string, token: string) {
  const provider = user.settings.textProvider;
  const isExternalAPI = provider === 'openai' || provider === 'openrouter';
  const apiUrl = provider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const providerName = provider === 'openrouter' ? "OpenRouter" : "OpenAI";
  const textKey = resolveProviderKey(username, token, provider, provider === 'openrouter' ? user.settings.openRouterKey : user.settings.openAiKey);
  const geminiKey = resolveProviderKey(username, token, 'gemini', user.settings.geminiKey);
  return { 
    isExternalAPI, 
    apiUrl, 
    apiKey: textKey.key,
    providerName, 
    textModel: user.settings.textModel,
    geminiKey: geminiKey.key,
    usingByok: textKey.usingByok || (!isExternalAPI && geminiKey.usingByok),
  };
}

app.post('/api/ai/mutation', requireAuth, async (req, res) => {
  try {
    const username = (req as any).username;
    const user = (req as any).user;
    const { proposal, currentStats } = req.body;
    const apiMeta = getApiMeta(user, username, tokenFromReq(req));
    const billing = apiMeta.usingByok ? noopAiBilling : createAiBilling(username);
    const result = await evaluateMutationProposal(proposal, currentStats, { ...apiMeta, billing } as any);
    res.json({ success: true, result });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/ai/image', requireAuth, async (req, res) => {
  try {
    const username = (req as any).username;
    const user = (req as any).user;
    const { timelineText, location, terrainContext } = req.body;
    const { imageModel } = user.settings;
    const token = tokenFromReq(req);
    const openAiKey = resolveProviderKey(username, token, 'openai', user.settings.openAiKey);
    const geminiKey = resolveProviderKey(username, token, 'gemini', user.settings.geminiKey);
    const imageUsesByok = imageModel === 'dall-e-3' ? openAiKey.usingByok : geminiKey.usingByok;
    const result = await generateCityImage(
      timelineText, 
      location, 
      imageModel, 
      openAiKey.key,
      terrainContext, 
      geminiKey.key,
      imageUsesByok ? noopAiBilling : createAiBilling(username)
    );
    res.json({ success: true, image: result });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/ai/simulate', requireAuth, async (req, res) => {
  let streamStarted = false;
  try {
    const username = (req as any).username;
    const user = (req as any).user;
    const params = req.body;
    const token = tokenFromReq(req);
    const apiMeta = getApiMeta(user, username, token);
    // Inject server-side keys
    params.geminiKey = apiMeta.geminiKey;
    params.openAiKey = resolveProviderKey(username, token, 'openai', user.settings.openAiKey).key;
    params.openRouterKey = resolveProviderKey(username, token, 'openrouter', user.settings.openRouterKey).key;
    params.textProvider = user.settings.textProvider;
    params.textModel = user.settings.textModel;
    params.billing = apiMeta.usingByok ? noopAiBilling : createAiBilling(username);

    // Send SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    streamStarted = true;

    // Override the onMapData to stream map data updates back to client
    params.onMapData = (dayNum: number, dayDelta: any) => {
      res.write(`data: ${JSON.stringify({ type: 'mapUpdate', dayNum, dayDelta })}\n\n`);
    };
    params.onNotification = (msg: string, type: string) => {
      res.write(`data: ${JSON.stringify({ type: 'notification', message: msg, notifType: type })}\n\n`);
    };

    const stream = simulateOutbreakStepStream(params);
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err: any) {
    if (streamStarted) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    } else {
      sendError(res, err);
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
