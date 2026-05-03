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
  imageMode: 'off',
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

const SESSION_KEY = 'projectz_token';

// Helper to clear localStorage users
if (localStorage.getItem('projectz_users')) {
  localStorage.removeItem('projectz_users'); // Remove vulnerable data!
}

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function getSessionUsername(): string | null {
  return localStorage.getItem('projectz_username');
}

export async function registerUser(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem(SESSION_KEY, data.token);
      localStorage.setItem('projectz_username', data.username);
      return { success: true };
    }
    return { success: false, error: data.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function loginUser(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (res.status === 429) {
      const data = await res.json();
      return { success: false, error: data.error };
    }
    const data = await res.json();
    if (data.success) {
      localStorage.setItem(SESSION_KEY, data.token);
      localStorage.setItem('projectz_username', data.username);
      return { success: true };
    }
    return { success: false, error: data.error || 'Ошибка входа' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function logoutUser(): Promise<void> {
  const token = getSessionToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
  }
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('projectz_username');
}

let cachedUser: UserProfile | null = null;

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/user/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      cachedUser = data.user;
      return cachedUser;
    } else {
      logoutUser();
    }
  } catch (e) {}
  return null;
}

export function getCurrentUser(): UserProfile | null {
  return cachedUser; // Synchronous access for React components (relies on initial fetch)
}

export async function saveUserSettings(settings: UserSettings): Promise<void> {
  const token = getSessionToken();
  if (!token) return;
  if (cachedUser) cachedUser.settings = settings;
  try {
    await fetch('/api/user/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify(settings)
    });
  } catch (e) {}
}

export async function saveGame(gameSave: GameSave): Promise<void> {
  const token = getSessionToken();
  if (!token) return;
  if (cachedUser) cachedUser.gameSave = gameSave;
  try {
    await fetch('/api/user/game', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify(gameSave)
    });
  } catch (e) {}
}

export function loadGame(): GameSave | null {
  return cachedUser?.gameSave || null;
}

export function getUserSettings(): UserSettings {
  if (cachedUser?.settings) {
    return { ...DEFAULT_SETTINGS, ...cachedUser.settings };
  }
  return { ...DEFAULT_SETTINGS };
}
