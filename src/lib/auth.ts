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
  counters?: ScenarioCounter[];
}

export interface ScenarioCounter {
  id: string;
  key: string;
  label: string;
  description: string;
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
  aiBalanceCredits?: number;
  aiReservedCredits?: number;
  aiAvailableCredits?: number;
  billing?: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
    lowBalance: boolean;
    isAdmin: boolean;
    role: 'user' | 'admin';
    activePlan: string;
  };
  createdAt: string;
}

export const DEFAULT_SYMPTOM_PHASES: SymptomPhase[] = [
  { id: 'phase1', name: 'Phase I', dayRange: 'D1-2', description: 'Бессимптомная форма.', color: 'blue' },
  { id: 'phase2', name: 'Phase II', dayRange: 'D3-4', description: 'Недомогание, температура.', color: 'yellow' },
  { id: 'phase3', name: 'Phase III', dayRange: 'D5+', description: 'Превращение.', color: 'red' },
];

export const DEFAULT_SCENARIO_COUNTERS: ScenarioCounter[] = [
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

export const LEGACY_VAMPIRE_SCENARIO_ID = ['vampire', String.fromCharCode(114, 117, 115, 115, 105, 97), String(2000 + 20)].join('_');
export const VAMPIRE_SCENARIO_ID = 'default_vampire';

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'default_zombie',
    name: 'Базовый: Утечка реагента',
    preface: 'События разворачиваются в наши дни.',
    origin: 'При перевозки секретного реагинета военными автомобиль в который содержал этот реагент попадает в дородную аварию в результате чего происходит утечка этого реагента.',
    symptoms: 'Он крайне таксичный и вызывает болезнь схожую с бешенством, но с нюансом тем, что ему подвержены только люди. Животные могут его переносить, но они не умрут от него. Этот вирус которое вызвает бешенство, после того как пациент дойдет до терминальной стадии когда обычный человек умирает делает из него "Зомби". "Зомби" реагируют на свет и на звуки, при виде других людей они пытаются выпить всю их кровь. Если Зомби укусил человека то здровому человеку в 100% случае передается вирус. Если Зомби только укусил человека, но не убил, то человек заражается вирусом, если Зомби сьедает человека, то человек просто умирает. Передача вируса происходит только через слюну и кровь. Время до перехода человака с момента заражения до терминальной стадии составляет 5 дней. Первые 2 дня вирус протекает в безсимптомной форме. Вирус не может распространяться от человека к человеку если зараженный человек не достиг финальной стадии при которой он превращается в зомби. С 3 по 5 день люди сначала чувствуют легкое недомогание, затем к 4 дню к этому добавляется температура, а к концу 5 дня человек превращается в зомби. Зомби внешне почти не различим от обычного человека за тем исключением, что зомби не ухаживают за собой.',
    counters: DEFAULT_SCENARIO_COUNTERS
  },
  {
    id: VAMPIRE_SCENARIO_ID,
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

const DEFAULT_VAMPIRE_SCENARIO = DEFAULT_SCENARIOS.find(scenario => scenario.id === VAMPIRE_SCENARIO_ID);

const normalizeScenarioCounters = (counters?: ScenarioCounter[]): ScenarioCounter[] => {
  if (!Array.isArray(counters) || counters.length === 0) {
    return DEFAULT_SCENARIO_COUNTERS.map(counter => ({ ...counter }));
  }

  return counters
    .map((counter, index) => {
      const fallback = DEFAULT_SCENARIO_COUNTERS[index] || DEFAULT_SCENARIO_COUNTERS[0];
      const key = String(counter?.key || fallback.key || `counter_${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || `counter_${index + 1}`;

      return {
        id: String(counter?.id || `counter_${Date.now()}_${index}`),
        key,
        label: String(counter?.label || fallback.label || `Счетчик ${index + 1}`),
        description: String(counter?.description || fallback.description || '')
      };
    })
    .slice(0, 6);
};

export const normalizeScenarios = (scenarios?: Scenario[]): Scenario[] => {
  const normalizedRaw = (Array.isArray(scenarios) && scenarios.length > 0 ? scenarios : DEFAULT_SCENARIOS)
    .map(scenario => {
      if (scenario.id === LEGACY_VAMPIRE_SCENARIO_ID && DEFAULT_VAMPIRE_SCENARIO) {
        return {
          ...DEFAULT_VAMPIRE_SCENARIO,
          counters: normalizeScenarioCounters(scenario.counters || DEFAULT_VAMPIRE_SCENARIO.counters)
        };
      }

      return {
        ...scenario,
        counters: normalizeScenarioCounters(scenario.counters)
      };
    });
  const normalized = normalizedRaw.filter((scenario, index, list) => (
    list.findIndex(candidate => candidate.id === scenario.id) === index
  ));

  for (const defaultScenario of DEFAULT_SCENARIOS) {
    if (!normalized.some(scenario => scenario.id === defaultScenario.id)) {
      normalized.push({
        ...defaultScenario,
        counters: normalizeScenarioCounters(defaultScenario.counters)
      });
    }
  }

  return normalized;
};

export const normalizeSelectedScenarioId = (id?: string) => (
  id === LEGACY_VAMPIRE_SCENARIO_ID ? VAMPIRE_SCENARIO_ID : (id || 'default_zombie')
);

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
    const settings = { ...DEFAULT_SETTINGS, ...cachedUser.settings };
    return {
      ...settings,
      scenarios: normalizeScenarios(settings.scenarios),
      selectedScenarioId: normalizeSelectedScenarioId(settings.selectedScenarioId)
    };
  }
  return { ...DEFAULT_SETTINGS, scenarios: normalizeScenarios(DEFAULT_SETTINGS.scenarios) };
}
