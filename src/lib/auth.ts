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

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_projectz_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  if (!password || password.length < 4) return { success: false, error: 'Пароль должен быть не менее 4 символов' };

  const users = getAllUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    return { success: false, error: 'Пользователь с таким именем уже существует' };
  }

  const passwordHash = await hashPassword(password);
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
  if (!username || !password) return { success: false, error: 'Введите имя пользователя и пароль' };

  const users = getAllUsers();
  const key = username.toLowerCase();
  const user = users[key];

  if (!user) {
    return { success: false, error: 'Пользователь не найден' };
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return { success: false, error: 'Неверный пароль' };
  }

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
