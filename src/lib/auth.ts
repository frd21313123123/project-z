// Simple localStorage-based auth & settings persistence

const USERS_KEY = 'projectz_users';
const SESSION_KEY = 'projectz_session';

export interface SymptomPhase {
  id: string;
  name: string;
  dayRange: string;
  description: string;
  color: 'blue' | 'yellow' | 'red' | 'green' | 'purple' | 'orange' | 'cyan';
}

export interface Scenario {
  id: string;
  name: string;
  preface: string;
  origin: string;
  symptoms: string;
}

export interface Mutation {
  id: string;
  name: string;
  description: string;
  cost: number;
  dayApplied: number;
}

export interface GameSave {
  timeline: string;
  mapSnapshots: Record<number, any>;
  mutationPoints: number;
  activeMutations: Mutation[];
  symptomPhases: SymptomPhase[];
  startDate: string;
  location: [number, number];
  selectedScenarioId: string;
  scenarios: Scenario[];
  images: Record<number, string>;
  imagePrompts: Record<number, string>;
  lastUpdated: string;
}

export interface UserSettings {
  textProvider: 'gemini' | 'openai' | 'openrouter';
  textModel: string;
  imageModel: string;
  imageMode: 'on' | 'off' | 'prompt';
  geminiKey: string;
  openAiKey: string;
  openRouterKey: string;
  showMapOverlay: boolean;
  symptomPhases: SymptomPhase[];
  textScale?: number;
  scenarios?: Scenario[];
  selectedScenarioId?: string;
  mutationPoints?: number;
  mutations?: Mutation[];
}

export interface UserProfile {
  username: string;
  passwordHash: string;
  settings: UserSettings;
  gameSave?: GameSave;
  createdAt: string;
}

export const DEFAULT_SYMPTOM_PHASES: SymptomPhase[] = [
  { id: 'phase1', name: 'Phase I', dayRange: 'D1-2', description: 'Бессимптомная форма.', color: 'blue' },
  { id: 'phase2', name: 'Phase II', dayRange: 'D3-4', description: 'Недомогание, температура.', color: 'yellow' },
  { id: 'phase3', name: 'Phase III', dayRange: 'D5+', description: 'Превращение.', color: 'red' },
];

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'default_zombie',
    name: 'Базовый: Утечка реагента',
    preface: 'События разворачиваются в наши дни.',
    origin: 'При перевозки секретного реагинета военными автомобиль в который содержал этот реагент попадает в дородную аварию в результате чего происходит утечка этого реагента.',
    symptoms: 'Он крайне таксичный и вызывает болезнь схожую с бешенством, но с нюансом тем, что ему подвержены только люди. Животные могут его переносить, но они не умрут от него. Этот вирус которое вызвает бешенство, после того как пациент дойдет до терминальной стадии когда обычный человек умирает делает из него "Зомби". "Зомби" реагируют на свет и на звуки, при виде других людей они пытаются выпить всю их кровь. Если Зомби укусил человека то здровому человеку в 100% случае передается вирус. Если Зомби только укусил человека, но не убил, то человек заражается вирусом, если Зомби сьедает человека, то человек просто умирает. Передача вируса происходит только через слюну и кровь. Время до перехода человака с момента заражения до терминальной стадии составляет 5 дней. Первые 2 дня вирус протекает в безсимптомной форме. Вирус не может распространяться от человека к человеку если зараженный человек не достиг финальной стадии при которой он превращается в зомби. С 3 по 5 день люди сначала чувствуют легкое недомогание, затем к 4 дню к этому добавляется температура, а к концу 5 дня человек превращается в зомби. Зомби внешне почти не различим от обычного человека за тем исключением, что зомби не ухаживают за собой.'
  }
];

export const DEFAULT_SETTINGS: UserSettings = {
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

// --- Crypto helpers ---
const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));

const PBKDF2_ITERATIONS = 100_000;

/** Modern PBKDF2 password hashing with random per-user salt. Returns `pbkdf2:iterations:saltHex:hashHex`. */
async function hashPasswordPBKDF2(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

/** Verify a password against a PBKDF2 hash string. */
async function verifyPasswordPBKDF2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHash = parts[3];
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(derivedBits)) === expectedHash;
}

/** Verify against the legacy SHA-256 + static salt scheme (for migration only). */
async function verifyLegacyPassword(password: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_projectz_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = toHex(new Uint8Array(hashBuffer));
  return hashHex === storedHash;
}

// --- Rate limiting ---
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function recordFailedAttempt(key: string): void {
  const current = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  current.count += 1;
  if (current.count >= MAX_LOGIN_ATTEMPTS) {
    current.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(key, current);
}

let usersCache: Record<string, UserProfile> | null = null;

function getAllUsers(): Record<string, UserProfile> {
  if (usersCache) return usersCache;
  try {
    const raw = localStorage.getItem(USERS_KEY);
    usersCache = raw ? JSON.parse(raw) : {};
    return usersCache!;
  } catch {
    return {};
  }
}

function saveAllUsers(users: Record<string, UserProfile>): void {
  usersCache = users;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function registerUser(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  if (!username || username.length < 2) return { success: false, error: 'Имя пользователя должно быть не менее 2 символов' };
  if (!password || password.length < 8) return { success: false, error: 'Пароль должен быть не менее 8 символов' };

  const users = getAllUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    return { success: false, error: 'Пользователь с таким именем уже существует' };
  }

  const passwordHash = await hashPasswordPBKDF2(password);
  users[key] = {
    username,
    passwordHash,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: new Date().toISOString(),
  };

  saveAllUsers(users);
  localStorage.setItem(SESSION_KEY, key);
  return { success: true };
}

export async function loginUser(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  const AUTH_ERROR = 'Неверное имя пользователя или пароль';

  if (!username || !password) return { success: false, error: 'Введите имя пользователя и пароль' };

  const key = username.toLowerCase();

  // Rate limiting check
  const attempts = loginAttempts.get(key);
  if (attempts && attempts.lockedUntil > Date.now()) {
    const remainingSec = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    return { success: false, error: `Слишком много попыток. Повторите через ${remainingSec} сек.` };
  }

  const users = getAllUsers();
  const user = users[key];

  if (!user) {
    recordFailedAttempt(key);
    return { success: false, error: AUTH_ERROR };
  }

  // Try PBKDF2 first, then fall back to legacy SHA-256 for migration
  let passwordValid = false;
  const isPBKDF2 = user.passwordHash.startsWith('pbkdf2:');

  if (isPBKDF2) {
    passwordValid = await verifyPasswordPBKDF2(password, user.passwordHash);
  } else {
    passwordValid = await verifyLegacyPassword(password, user.passwordHash);
  }

  if (!passwordValid) {
    recordFailedAttempt(key);
    return { success: false, error: AUTH_ERROR };
  }

  // Migrate legacy hash to PBKDF2 on successful login
  if (!isPBKDF2) {
    user.passwordHash = await hashPasswordPBKDF2(password);
    saveAllUsers(users);
  }

  // Clear failed attempts on success
  loginAttempts.delete(key);

  localStorage.setItem(SESSION_KEY, key);
  return { success: true };
}

export function logoutUser(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getCurrentUser(): UserProfile | null {
  const key = localStorage.getItem(SESSION_KEY);
  if (!key) return null;

  const users = getAllUsers();
  return users[key] || null;
}

export function getSessionUsername(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function saveUserSettings(settings: UserSettings): void {
  const key = localStorage.getItem(SESSION_KEY);
  if (!key) return;

  const users = getAllUsers();
  if (users[key]) {
    users[key].settings = settings;
    saveAllUsers(users);
  }
}

export function saveGame(gameSave: GameSave): void {
  const key = localStorage.getItem(SESSION_KEY);
  if (!key) return;

  const users = getAllUsers();
  if (users[key]) {
    users[key].gameSave = gameSave;
    saveAllUsers(users);
  }
}

export function loadGame(): GameSave | null {
  const user = getCurrentUser();
  return user?.gameSave || null;
}

export function getUserSettings(): UserSettings {
  const user = getCurrentUser();
  if (user?.settings) {
    // Merge with defaults to handle newly added fields
    return { ...DEFAULT_SETTINGS, ...user.settings };
  }
  return { ...DEFAULT_SETTINGS };
}
