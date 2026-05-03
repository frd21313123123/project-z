import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '../.env.local' });
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

function saveSessions() {
  saveDB(SESSIONS_FILE, sessions);
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
  next();
}

const DEFAULT_SYMPTOM_PHASES = [
  { id: 'phase1', name: 'Phase I', dayRange: 'D1-2', description: 'Бессимптомная форма.', color: 'blue' },
  { id: 'phase2', name: 'Phase II', dayRange: 'D3-4', description: 'Недомогание, температура.', color: 'yellow' },
  { id: 'phase3', name: 'Phase III', dayRange: 'D5+', description: 'Превращение.', color: 'red' },
];

const DEFAULT_SCENARIOS = [
  {
    id: 'default_zombie',
    name: 'Базовый: Утечка реагента',
    preface: 'События разворачиваются в наши дни.',
    origin: 'При перевозки секретного реагинета военными автомобиль в который содержал этот реагент попадает в дородную аварию в результате чего происходит утечка этого реагента.',
    symptoms: 'Он крайне таксичный и вызывает болезнь схожую с бешенством, но с нюансом тем, что ему подвержены только люди. Животные могут его переносить, но они не умрут от него. Этот вирус которое вызвает бешенство, после того как пациент дойдет до терминальной стадии когда обычный человек умирает делает из него "Зомби". "Зомби" реагируют на свет и на звуки, при виде других людей они пытаются выпить всю их кровь. Если Зомби укусил человека то здровому человеку в 100% случае передается вирус. Если Зомби только укусил человека, но не убил, то человек заражается вирусом, если Зомби сьедает человека, то человек просто умирает. Передача вируса происходит только через слюну и кровь. Время до перехода человака с момента заражения до терминальной стадии составляет 5 дней. Первые 2 дня вирус протекает в безсимптомной форме. Вирус не может распространяться от человека к человеку если зараженный человек не достиг финальной стадии при которой он превращается в зомби. С 3 по 5 день люди сначала чувствуют легкое недомогание, затем к 4 дню к этому добавляется температура, а к концу 5 дня человек превращается в зомби. Зомби внешне почти не различим от обычного человека за тем исключением, что зомби не ухаживают за собой.'
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
  saveSessions();
  res.json({ success: true });
});

// --- USER DATA ROUTES ---
app.get('/api/user/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  // Return user data without password hash
  const { passwordHash, ...safeUser } = user;
  
  // Merge settings with defaults
  safeUser.settings = { ...DEFAULT_SETTINGS, ...(safeUser.settings || {}) };
  
  res.json({ success: true, user: safeUser });
});

app.post('/api/user/settings', requireAuth, (req, res) => {
  const username = (req as any).username;
  const users = getDB(USERS_FILE);
  users[username].settings = req.body;
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



import { evaluateMutationProposal, generateCityImage, buildCityImagePrompt, simulateOutbreakStepStream } from './gemini';

// --- AI Proxy Routes ---
function getApiMeta(user: any) {
  const isExternalAPI = user.settings.textProvider === 'openai' || user.settings.textProvider === 'openrouter';
  const apiUrl = user.settings.textProvider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const apiKey = user.settings.textProvider === 'openrouter' ? user.settings.openRouterKey : user.settings.openAiKey;
  const providerName = user.settings.textProvider === 'openrouter' ? "OpenRouter" : "OpenAI";
  return { 
    isExternalAPI, 
    apiUrl, 
    apiKey: apiKey || process.env.OPENAI_API_KEY, 
    providerName, 
    textModel: user.settings.textModel,
    geminiKey: user.settings.geminiKey || process.env.GEMINI_API_KEY
  };
}

app.post('/api/ai/mutation', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { proposal, currentStats } = req.body;
    const apiMeta = getApiMeta(user);
    const result = await evaluateMutationProposal(proposal, currentStats, apiMeta as any);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/image', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const { timelineText, location, terrainContext } = req.body;
    const { imageModel, openAiKey, geminiKey } = user.settings;
    const result = await generateCityImage(
      timelineText, 
      location, 
      imageModel, 
      openAiKey || process.env.OPENAI_API_KEY, 
      terrainContext, 
      geminiKey || process.env.GEMINI_API_KEY
    );
    res.json({ success: true, image: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/simulate', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const params = req.body;
    // Inject server-side keys
    params.geminiKey = user.settings.geminiKey || process.env.GEMINI_API_KEY;
    params.openAiKey = user.settings.openAiKey || process.env.OPENAI_API_KEY;
    params.openRouterKey = user.settings.openRouterKey || process.env.OPENROUTER_API_KEY;
    params.textProvider = user.settings.textProvider;
    params.textModel = user.settings.textModel;

    // Send SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

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
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
