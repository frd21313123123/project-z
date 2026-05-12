import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { BalanceScreen } from './components/BalanceScreen';
import { AdminScreen } from './components/AdminScreen';
import { simulateOutbreakStepStream, generateCityImage, buildCityImagePrompt, evaluateMutationProposal } from './lib/gemini';
import { buildTerrainContext } from './lib/geoContext';
import { getSessionUsername, getSessionToken, fetchCurrentUser, getUserSettings, saveUserSettings, logoutUser, saveGame, loadGame, type UserSettings, type SymptomPhase, DEFAULT_SYMPTOM_PHASES, type Scenario, DEFAULT_SCENARIOS, DEFAULT_SCENARIO_COUNTERS, normalizeScenarios, normalizeSelectedScenarioId, type GameSave, type Mutation } from './lib/auth';
import { fetchBillingSummary, type BillingSummary } from './lib/billing';
import { Biohazard, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Settings, X, LogOut, Eye, EyeOff, Pencil, Plus, Trash2, Check, RotateCcw, UserRound, Skull, Microscope, Dna, Save, Upload, Download, Wallet, AlertTriangle } from 'lucide-react';

// Lazy load heavy components
const MapView = lazy(() => import('./components/MapView').then(module => ({ default: module.MapView })));
const MainMenuScreen = lazy(() => import('./components/MainMenuScreen').then(module => ({ default: module.MainMenuScreen })));
const ScenarioSelectScreen = lazy(() => import('./components/ScenarioSelectScreen').then(module => ({ default: module.ScenarioSelectScreen })));
const ReactMarkdown = lazy(() => import('react-markdown'));

interface TimelineEvent {
  day: number;
  dateStr: string;
  text: string;
  raw: string;
  mapData?: any;
}

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'error' | 'warning';
}

const emptyMapData = () => ({ infected: [], movements: [], pois: [], perimeters: [], stats: {} });

const normalizeMapData = (mapData: any) => ({
  infected: Array.isArray(mapData?.infected) ? mapData.infected : [],
  movements: Array.isArray(mapData?.movements) ? mapData.movements : [],
  pois: Array.isArray(mapData?.pois) ? mapData.pois : [],
  perimeters: Array.isArray(mapData?.perimeters) ? mapData.perimeters : [],
  stats: mapData?.stats,
  counts: mapData?.counts,
  totalInfected: mapData?.totalInfected,
  totalZombies: mapData?.totalZombies
});

const getCounterValue = (mapData: any, key: string) => {
  const legacyValue = key === 'infected'
    ? mapData?.totalInfected
    : key === 'zombies'
      ? mapData?.totalZombies
      : undefined;
  const explicitCount = Number(mapData?.stats?.[key] ?? mapData?.counts?.[key] ?? legacyValue);
  if (Number.isFinite(explicitCount)) return Math.max(0, Math.round(explicitCount));
  return 0;
};

const formatCounter = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

const DAY_HEADER_REGEX = /(?:^|\n|[ \t]|[\.\!\?])(?:\*\*|#{1,6}\s*)?DAY_(\d+)(?:[ \t]*\(([^)\n]+)\))?[ \t]*(?:\*\*)?[ \t]*:?[ \t]*/g;

const buildMapDataSnapshot = (events: TimelineEvent[], lastIndex: number, snapshots: Record<number, any>) => {
  if (!events.length || lastIndex < 0) return emptyMapData();

  const event = events[lastIndex];
  if (!event) return emptyMapData();

  if (snapshots && snapshots[event.day]) {
    return normalizeMapData(snapshots[event.day]);
  } 
  
  if (event.mapData) {
    return normalizeMapData(event.mapData);
  }

  return emptyMapData();
};

const LoadingUI = () => (
  <div className="w-full h-full flex items-center justify-center bg-[#050505] text-red-500 font-mono text-xs uppercase tracking-widest">
    <Loader2 className="w-6 h-6 animate-spin mr-3" />
    Загрузка системы...
  </div>
);

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);

  useEffect(() => {
    async function init() {
      if (getSessionToken()) {
        const user = await fetchCurrentUser();
        if (user) {
          setIsAuthed(true);
          setCurrentUsername(user.username);
          if (user.billing) setBillingSummary(user.billing as BillingSummary);
        } else {
          setIsAuthed(false);
        }
      }
      setIsInitializing(false);
    }
    init();
  }, []);



  useEffect(() => {
    if (!isInitializing && isAuthed) {
      const settings = getUserSettings();
      setTextProvider(settings.textProvider);
      setTextModel(settings.textModel);
      setImageModel(settings.imageModel);
      setImageMode(settings.imageMode);
      setGeminiKey(settings.geminiKey || '');
      setOpenAiKey(settings.openAiKey);
      setOpenRouterKey(settings.openRouterKey);
      setShowMapOverlay(settings.showMapOverlay);
      setSymptomPhases(settings.symptomPhases || DEFAULT_SYMPTOM_PHASES);
      setScenarios(normalizeScenarios(settings.scenarios));
      setSelectedScenarioId(normalizeSelectedScenarioId(settings.selectedScenarioId));
      setMutationPoints(settings.mutationPoints ?? 80);
      setActiveMutations(settings.mutations || []);
      if (settings.textScale) setTextScale(settings.textScale);
    }
  }, [isInitializing, isAuthed]);

  const [isMainMenu, setIsMainMenu] = useState(true);
  const [isBalanceScreenOpen, setIsBalanceScreenOpen] = useState(false);
  const [isAdminScreenOpen, setIsAdminScreenOpen] = useState(false);
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const [isScenarioSelectOpen, setIsScenarioSelectOpen] = useState(false);
  const [isDiseaseWindowOpen, setIsDiseaseWindowOpen] = useState(false);
  const [diseaseTab, setDiseaseTab] = useState<'overview' | 'phases'>('overview');

  const handleAuthSuccess = useCallback(() => {
    setIsAuthed(true);
    setCurrentUsername(getSessionUsername() || '');
    fetchBillingSummary().then(setBillingSummary).catch(() => {});
    // Load saved settings
    const saved = getUserSettings();
    setTextProvider(saved.textProvider);
    setTextModel(saved.textModel);
    setImageModel(saved.imageModel);
    setImageMode(saved.imageMode);
    setGeminiKey(saved.geminiKey || '');
    setOpenAiKey(saved.openAiKey);
    setOpenRouterKey(saved.openRouterKey);
    setShowMapOverlay(saved.showMapOverlay);
    setSymptomPhases(saved.symptomPhases || DEFAULT_SYMPTOM_PHASES);
    setScenarios(normalizeScenarios(saved.scenarios));
    setSelectedScenarioId(normalizeSelectedScenarioId(saved.selectedScenarioId));
    setMutationPoints(saved.mutationPoints ?? 80);
    setActiveMutations(saved.mutations || []);
    }, []);

  const handleLogout = useCallback(() => {
    logoutUser();
    setIsAuthed(false);
    setCurrentUsername('');
    setBillingSummary(null);
    setIsMainMenu(true);
    setIsBalanceScreenOpen(false);
    setIsAdminScreenOpen(false);
    setIsRoleSelectOpen(false);
    setIsScenarioSelectOpen(false);
  }, []);

  const [location, setLocation] = useState<[number, number]>([55.7558, 37.6173]);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [scenarios, setScenarios] = useState<Scenario[]>(normalizeScenarios(DEFAULT_SCENARIOS));
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('default_zombie');
  const activeScenario = useMemo(() => scenarios.find(s => s.id === selectedScenarioId) || scenarios[0], [scenarios, selectedScenarioId]);
  const activeScenarioCounters = useMemo(() => (
    activeScenario?.counters?.length ? activeScenario.counters : DEFAULT_SCENARIO_COUNTERS
  ), [activeScenario]);

  const updateScenario = useCallback((id: string, field: keyof Scenario, value: Scenario[keyof Scenario]) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  const [mainView, setMainView] = useState<'map' | 'timeline' | 'split' | 'chat'>('map');
  const [isImageGenerating, setIsImageGenerating] = useState(false);

  const [stepAmount, setStepAmount] = useState('1 день');
  const [eventFrequency, setEventFrequency] = useState('на твое усмотрение');
  const [elapsedDays, setElapsedDays] = useState(0);
  const [timeline, setTimeline] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [mapSnapshots, setMapSnapshots] = useState<Record<number, any>>({ 0: null });
  const [images, setImages] = useState<Record<number, string>>({});
  const [imagePrompts, setImagePrompts] = useState<Record<number, string>>({});
  const [mutationPoints, setMutationPoints] = useState(50);
  const [activeMutations, setActiveMutations] = useState<Mutation[]>([]);

  // Map controls
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);

  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [imageMode, setImageMode] = useState<'on' | 'off' | 'prompt'>('off');
  const [textProvider, setTextProvider] = useState<'gemini' | 'openai' | 'openrouter'>('gemini');
  const [textModel, setTextModel] = useState('gemini-3.1-pro-preview');
  const [imageModel, setImageModel] = useState('imagen-3.0-generate-002');
  const [geminiKey, setGeminiKey] = useState('');
  const [openAiKey, setOpenAiKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [showMapOverlay, setShowMapOverlay] = useState(true);
  const [symptomPhases, setSymptomPhases] = useState<SymptomPhase[]>(DEFAULT_SYMPTOM_PHASES);
  const [textScale, setTextScale] = useState<number>(1.0);
  
  const [mutationProposal, setMutationProposal] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<{ approved: boolean; cost: number; reason: string; name: string } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(-1);

  const handleResetGame = useCallback((confirm = true) => {
    if (confirm && timeline !== '' && !window.confirm("Вы уверены, что хотите сбросить текущую игру? Весь прогресс будет потерян.")) {
      return;
    }
    setTimeline('');
    setMapSnapshots({});
    setMutationPoints(80);
    setActiveMutations([]);
    setImages({});
    setImagePrompts({});
    setSelectedDayIndex(-1);
  }, [timeline]);

  const handleSelectScenario = useCallback((id: string) => {
    if (id !== selectedScenarioId) {
      if (timeline !== '' && !window.confirm("Смена сценария приведет к сбросу текущей игры. Продолжить?")) {
        return;
      }
      setSelectedScenarioId(id);
      handleResetGame(false);
    }
  }, [selectedScenarioId, timeline, handleResetGame]);

  const handleAddScenario = useCallback(() => {
    const newId = `scen_${Date.now()}`;
    const newScenario: Scenario = {
      id: newId,
      name: 'Новый сценарий',
      preface: '',
      origin: '',
      symptoms: '',
      counters: DEFAULT_SCENARIO_COUNTERS.map(counter => ({ ...counter }))
    };
    setScenarios(prev => [...prev, newScenario]);
    handleSelectScenario(newId);
    return newId;
  }, [handleSelectScenario]);

  const handleDeleteScenario = useCallback((id: string) => {
    setScenarios(prev => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter(s => s.id !== id);
      if (selectedScenarioId === id) handleSelectScenario(filtered[0].id);
      return filtered;
    });
  }, [selectedScenarioId, handleSelectScenario]);

  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((message: string, type: Notification['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  const refreshBillingSummary = useCallback(async () => {
    try {
      setBillingSummary(await fetchBillingSummary());
    } catch (e) {}
  }, []);

  const compileSaveData = useCallback((): GameSave => {
    return {
      timeline,
      mapSnapshots,
      mutationPoints,
      activeMutations,
      symptomPhases,
      startDate,
      location,
      selectedScenarioId,
      scenarios,
      images,
      imagePrompts,
      lastUpdated: new Date().toISOString()
    };
  }, [timeline, mapSnapshots, mutationPoints, activeMutations, symptomPhases, startDate, location, selectedScenarioId, scenarios, images, imagePrompts]);

  const applySaveData = useCallback((save: GameSave) => {
    setTimeline(save.timeline || '');
    setMapSnapshots(save.mapSnapshots || {});
    setMutationPoints(save.mutationPoints ?? 80);
    setActiveMutations(save.activeMutations || []);
    setSymptomPhases(save.symptomPhases || DEFAULT_SYMPTOM_PHASES);
    setStartDate(save.startDate || '1989-07-03');
    setLocation(save.location || [39.8283, -98.5795]);
    setSelectedScenarioId(normalizeSelectedScenarioId(save.selectedScenarioId));
    if (save.scenarios) setScenarios(normalizeScenarios(save.scenarios));
    setImages(save.images || {});
    setImagePrompts(save.imagePrompts || {});
    setSelectedDayIndex(-1);
    addNotification('Прогресс игры успешно загружен', 'info');
  }, [addNotification]);

  const handleSaveGameLocal = useCallback(() => {
    try {
      const saveData = compileSaveData();
      saveGame(saveData);
      addNotification('Игра сохранена в браузере', 'info');
    } catch (e: any) {
      addNotification('Ошибка сохранения: ' + e.message, 'error');
    }
  }, [compileSaveData, addNotification]);

  const handleLoadGameLocal = useCallback(() => {
    const save = loadGame();
    if (save) {
      if (timeline !== '' && !window.confirm("Загрузка перезапишет текущий прогресс. Продолжить?")) return;
      applySaveData(save);
    } else {
      addNotification('Сохранение не найдено', 'warning');
    }
  }, [timeline, applySaveData, addNotification]);

  const handleExportGameFile = useCallback(() => {
    try {
      const saveData = compileSaveData();
      const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `projectz_save_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addNotification('Файл сохранения экспортирован', 'info');
    } catch (e: any) {
      addNotification('Ошибка экспорта: ' + e.message, 'error');
    }
  }, [compileSaveData, addNotification]);

  const handleImportGameFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      // Reject files larger than 50MB to prevent DoS via localStorage overflow
      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        addNotification('Ошибка импорта: файл слишком большой (макс. 50 МБ)', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (re) => {
        try {
          const raw = re.target?.result as string;
          const save = JSON.parse(raw);

          // Validate required fields and types
          if (typeof save !== 'object' || save === null || Array.isArray(save)) {
            throw new Error('Root must be a JSON object');
          }
          if (save.timeline !== undefined && typeof save.timeline !== 'string') {
            throw new Error('timeline must be a string');
          }
          if (save.mapSnapshots !== undefined && (typeof save.mapSnapshots !== 'object' || Array.isArray(save.mapSnapshots))) {
            throw new Error('mapSnapshots must be an object');
          }
          if (save.mutationPoints !== undefined && typeof save.mutationPoints !== 'number') {
            throw new Error('mutationPoints must be a number');
          }
          if (save.activeMutations !== undefined && !Array.isArray(save.activeMutations)) {
            throw new Error('activeMutations must be an array');
          }
          if (save.symptomPhases !== undefined && !Array.isArray(save.symptomPhases)) {
            throw new Error('symptomPhases must be an array');
          }
          if (save.location !== undefined) {
            if (!Array.isArray(save.location) || save.location.length !== 2 || !save.location.every((v: any) => typeof v === 'number' && Number.isFinite(v))) {
              throw new Error('location must be [lat, lng]');
            }
          }
          if (save.scenarios !== undefined && !Array.isArray(save.scenarios)) {
            throw new Error('scenarios must be an array');
          }
          if (save.images !== undefined && (typeof save.images !== 'object' || Array.isArray(save.images))) {
            throw new Error('images must be an object');
          }

          // Strip any __proto__ or constructor pollution attempts
          const sanitized = JSON.parse(JSON.stringify(save));

          if (timeline !== '' && !window.confirm("Импорт файла перезапишет текущий прогресс. Продолжить?")) return;
          applySaveData(sanitized);
        } catch (err: any) {
          addNotification(`Ошибка импорта: ${err.message || 'неверный формат файла'}`, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [timeline, applySaveData, addNotification]);

  useEffect(() => {
    if (!isAuthed) return;
    const settings: UserSettings = {
      textProvider, textModel, imageModel, imageMode,
      geminiKey, openAiKey, openRouterKey, showMapOverlay, symptomPhases, textScale,
      scenarios, selectedScenarioId,
      mutationPoints, mutations: activeMutations
    };
    saveUserSettings(settings);
  }, [textProvider, textModel, imageModel, imageMode, geminiKey, openAiKey, openRouterKey, showMapOverlay, symptomPhases, textScale, scenarios, selectedScenarioId, isAuthed, mutationPoints, activeMutations]);

  const timelineEndRef = useRef<HTMLDivElement>(null);

  const parsedEvents = useMemo(() => {
    const events: TimelineEvent[] = [];
    const headerRegex = new RegExp(DAY_HEADER_REGEX);
    const matches = Array.from(timeline.matchAll(headerRegex));

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const dayNum = parseInt(match[1], 10);
      const dateStr = match[2] || `DAY_${dayNum}`;
      const headerStartIndex = match.index;
      const nextMatchIndex = i + 1 < matches.length ? matches[i + 1].index : timeline.length;
      let rawText = timeline.substring(headerStartIndex + match[0].length, nextMatchIndex).trim();

      let mapData = undefined;
      const mapStartIndex = rawText.indexOf('[MAP_DATA:');
      if (mapStartIndex !== -1) {
        const jsonStart = rawText.indexOf('{', mapStartIndex);
        let mapEndIndex = rawText.lastIndexOf(']');
        if (mapEndIndex < mapStartIndex) mapEndIndex = rawText.length;
        if (jsonStart !== -1) {
          const jsonEnd = rawText.lastIndexOf('}');
          if (jsonEnd !== -1 && jsonEnd >= jsonStart) {
            const jsonStr = rawText.substring(jsonStart, jsonEnd + 1);
            try {
              mapData = JSON.parse(jsonStr);
              rawText = rawText.substring(0, mapStartIndex).trim() + '\n' + rawText.substring(mapEndIndex + 1).trim();
            } catch (e) {}
          }
        }
      }

      events.push({ day: dayNum, dateStr: dateStr, text: rawText, mapData: mapData, raw: match[0] + rawText });
    }

    const latestEventsMap = new Map<number, TimelineEvent>();
    for (const ev of events) latestEventsMap.set(ev.day, ev);
    const deduped = Array.from(latestEventsMap.values());
    deduped.sort((a, b) => a.day - b.day);
    return deduped;
  }, [timeline]);

  useEffect(() => {
    if (parsedEvents.length > 0 && selectedDayIndex === -1) {
      setSelectedDayIndex(0);
    } else if (isSimulating && parsedEvents.length > 0) {
      setSelectedDayIndex(parsedEvents.length - 1);
    } else if (!isSimulating && parsedEvents.length > 0 && selectedDayIndex === parsedEvents.length - 2) {
      setSelectedDayIndex(parsedEvents.length - 1);
    }
  }, [parsedEvents.length, isSimulating]);

  const startSimulationStep = async () => {
    setIsSimulating(true);
    if (parsedEvents.length === 0) {
      setTimeline('');
      setMapSnapshots({});
      setMutationPoints(80);
      setActiveMutations([]);
    }
    
    const lastEvent = parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1] : null;
    const elapsedDays = lastEvent ? lastEvent.day : 0;
    
    let nextDateStr = startDate;
    if (lastEvent) {
        try {
            const lastDate = new Date(lastEvent.dateStr);
            if (!isNaN(lastDate.getTime())) {
                const nextDate = new Date(lastDate);
                nextDate.setDate(nextDate.getDate() + 1);
                nextDateStr = nextDate.toISOString().split('T')[0];
            } else {
                nextDateStr = `День ${elapsedDays + 1}`;
            }
        } catch (e) {
            nextDateStr = `День ${elapsedDays + 1}`;
        }
    }

    const latestMapData = buildMapDataSnapshot(parsedEvents, parsedEvents.length - 1, mapSnapshots);

    try {
      const terrainContext = await buildTerrainContext(location);
      const symptomDesc = symptomPhases.map(p => `${p.name} (${p.dayRange}): ${p.description}`).join('\n');
      const stream = simulateOutbreakStepStream({
        location: `${location[0].toFixed(4)}, ${location[1].toFixed(4)}`,
        terrainContext,
        startDate,
        scenario: `[Предисловие]: ${activeScenario.preface}\n[Начало/Причина]: ${activeScenario.origin}\n[Симптомы/Особенности]: ${activeScenario.symptoms}`,
        scenarioCounters: activeScenarioCounters,
        symptomDescription: symptomDesc,
        currentDate: nextDateStr,
        elapsedDays,
        stepAmount,
        eventFrequency,
        previousTimeline: timeline,
        mapData: latestMapData,
        activeMutations: activeMutations,
        onMapData: (day: number, mapData: any) => {
          setMapSnapshots(prev => ({ ...prev, [day]: normalizeMapData(mapData) }));
        },
        onNotification: addNotification,
        textModel,
        textProvider,
        geminiKey,
        openAiKey,
        openRouterKey
      });

      let newTimelineChunk = "";
      for await (const chunk of stream) {
        setTimeline(prev => prev + chunk);
        newTimelineChunk += chunk;
      }

      const regex = /DAY_(\d+)/g;
      let match;
      let lastDayInChunk = -1;
      while ((match = regex.exec(newTimelineChunk)) !== null) {
          lastDayInChunk = parseInt(match[1], 10);
      }
      
      if (lastDayInChunk !== -1) {
          if (imageMode === 'on') {
              setIsImageGenerating(true);
              try {
                 const imgBase64 = await generateCityImage(newTimelineChunk, `${location[0].toFixed(2)}, ${location[1].toFixed(2)}`, imageModel, openAiKey, terrainContext, geminiKey);
                 setImages(prev => ({...prev, [lastDayInChunk]: imgBase64}));
              } catch (e: any) {
                 console.error("Image generation failed", e);
                 addNotification(`Системное предупреждение: не удалось получить визуализацию с дрона: ${e.message}`, 'warning');
              } finally {
                 setIsImageGenerating(false);
              }
          } else if (imageMode === 'prompt') {
              const prompt = buildCityImagePrompt(newTimelineChunk, `${location[0].toFixed(2)}, ${location[1].toFixed(2)}`, terrainContext);
              setImagePrompts(prev => ({...prev, [lastDayInChunk]: prompt}));
          }

          const daysGenerated = lastDayInChunk - elapsedDays;
          if (daysGenerated > 0) {
              const basePoints = daysGenerated * 10;
              const latestCounterData = buildMapDataSnapshot(parsedEvents, parsedEvents.length - 1, mapSnapshots);
              const pressureCounter = activeScenarioCounters[1] || activeScenarioCounters[0];
              const pressureValue = getCounterValue(latestCounterData, pressureCounter?.key || 'infected');
              const pressureBonus = Math.floor(Math.max(0, Math.log10(pressureValue + 1) * 20));
              setMutationPoints(prev => prev + basePoints + pressureBonus);
          }
      }

    } catch (e: any) {
      const message = e.message || 'Неизвестная ошибка';
      addNotification(message.includes('Не хватает') || message.includes('Недостаточно AI-кредитов')
        ? `Не хватает кредитов: ${message}`
        : `СИСТЕМНАЯ ОШИБКА: ${message}`, 'error');
    } finally {
      refreshBillingSummary();
      setIsSimulating(false);
    }
  };

  const currentDayMapData = useMemo(() => {
    if (!parsedEvents || parsedEvents.length === 0 || selectedDayIndex < 0) return undefined;
    return buildMapDataSnapshot(parsedEvents, selectedDayIndex, mapSnapshots);
  }, [parsedEvents, selectedDayIndex, mapSnapshots]);

  const outbreakCounters = useMemo(() => {
    return Object.fromEntries(
      activeScenarioCounters.map(counter => [counter.key, getCounterValue(currentDayMapData, counter.key)])
    ) as Record<string, number>;
  }, [activeScenarioCounters, currentDayMapData]);

  const currentEvent = parsedEvents[selectedDayIndex];

  const displayTimelineText = useMemo(() => {
    if (!currentEvent) return '';
    return currentEvent.text.replace(/\[MAP_DATA:[\s\S]*?\]/g, "").trim();
  }, [currentEvent]);

  const handleEvaluateMutation = async () => {
    if (!mutationProposal.trim()) return;
    setIsEvaluating(true);
    setEvaluationResult(null);
    try {
      const isExternalAPI = textProvider === 'openai' || textProvider === 'openrouter';
      const apiUrl = textProvider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
      const apiKey = textProvider === 'openrouter' ? openRouterKey : openAiKey;
      const providerName = textProvider === 'openrouter' ? "OpenRouter" : "OpenAI";
      
      const apiMeta = { isExternalAPI, apiUrl, apiKey, providerName, textModel, geminiKey };
      const currentElapsedDays = parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1].day : 0;
      
      const res = await evaluateMutationProposal(
        mutationProposal, 
        { ...outbreakCounters, elapsedDays: currentElapsedDays },
        apiMeta
      );
      setEvaluationResult(res);
    } catch (e: any) {
      alert("Ошибка при оценке мутации: " + e.message);
    } finally {
      refreshBillingSummary();
      setIsEvaluating(false);
    }
  };

  const handleApplyMutation = () => {
    if (!evaluationResult || !evaluationResult.approved) return;
    if (mutationPoints < evaluationResult.cost) {
      alert("Недостаточно Очков Мутации!");
      return;
    }

    const newMutation = {
      id: `mut_${Date.now()}`,
      name: evaluationResult.name,
      description: mutationProposal,
      cost: evaluationResult.cost,
      dayApplied: parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1].day : 0
    };

    setMutationPoints(prev => prev - evaluationResult.cost);
    setActiveMutations(prev => [...prev, newMutation]);
    setMutationProposal('');
    setEvaluationResult(null);
  };

  const handleRemoveMutation = (id: string) => {
    const mutation = activeMutations.find(m => m.id === id);
    if (!mutation) return;

    if (window.confirm(`Вы уверены, что хотите откатить мутацию "${mutation.name}"? Вам будет возвращено ${mutation.cost} ОМ.`)) {
      setMutationPoints(prev => prev + mutation.cost);
      setActiveMutations(prev => prev.filter(m => m.id !== id));
    }
  };

  if (isInitializing) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!isAuthed) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="bg-[#050505] text-[#A3A3A3] w-full h-screen font-mono flex flex-col select-none">
      <Suspense fallback={<LoadingUI />}>
      {isMainMenu ? (
        isBalanceScreenOpen ? (
          <BalanceScreen
            onBack={() => setIsBalanceScreenOpen(false)}
            onSummaryChange={setBillingSummary}
          />
        ) : isAdminScreenOpen ? (
          <AdminScreen onBack={() => setIsAdminScreenOpen(false)} />
        ) : isScenarioSelectOpen ? (
          <ScenarioSelectScreen
            scenarios={scenarios}
            selectedScenarioId={selectedScenarioId}
            activeScenario={activeScenario}
            onSelectScenario={handleSelectScenario}
            onAddScenario={handleAddScenario}
            onDeleteScenario={handleDeleteScenario}
            onUpdateScenario={updateScenario}
            onBack={() => {
              setIsScenarioSelectOpen(false);
              setIsRoleSelectOpen(true);
            }}
            onContinue={() => {
              handleResetGame(false);
              setIsScenarioSelectOpen(false);
              setIsRoleSelectOpen(false);
              setIsMainMenu(false);
            }}
          />
        ) : (
        <MainMenuScreen
          username={currentUsername}
          isRoleSelectOpen={isRoleSelectOpen}
          onOpenRoleSelect={() => setIsRoleSelectOpen(true)}
          onCloseRoleSelect={() => setIsRoleSelectOpen(false)}
          onStartVirusGame={() => {
            setIsRoleSelectOpen(false);
            setIsScenarioSelectOpen(true);
          }}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenBalance={() => setIsBalanceScreenOpen(true)}
          onOpenAdmin={() => setIsAdminScreenOpen(true)}
          onLogout={handleLogout}
          isAdmin={Boolean(billingSummary?.isAdmin)}
          availableCredits={billingSummary?.availableCredits || 0}
        />
        )
      ) : (
        <>
          {/* Header */}
          <header className="h-16 border-b border-[#333] flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Project Z Logo" className="w-10 h-10 object-contain" />
          <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse"></div>
          <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white uppercase flex items-center gap-2">
            PROJECT Z
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-6 text-sm">
          <div className="hidden xl:flex gap-8">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-[#555] uppercase">Simulation Date</span>
              <span className="text-orange-500">{currentEvent ? currentEvent.dateStr : startDate}</span>
            </div>
            <div className="flex flex-col items-end border-l border-[#333] pl-8">
              <span className="text-[10px] text-[#555] uppercase">Elapsed Time</span>
              <span className="text-orange-500">T + {currentEvent ? currentEvent.day : 0}d</span>
            </div>
            <div className="flex flex-col items-end border-l border-[#333] pl-8">
              <span className="text-[10px] text-[#555] uppercase">Origin Node</span>
              <span className="text-white">Lat: {location[0].toFixed(2)}, Lng: {location[1].toFixed(2)}</span>
            </div>
          </div>
          <button
            onClick={() => {
              setIsMainMenu(true);
              setIsBalanceScreenOpen(true);
              setIsAdminScreenOpen(false);
            }}
            className={`hidden md:flex items-center gap-2 border px-3 py-2 text-[10px] uppercase font-bold ${
              billingSummary?.lowBalance
                ? 'border-red-700 bg-red-950/30 text-red-200'
                : 'border-[#333] bg-[#111] text-green-300'
            }`}
            title="Открыть баланс"
          >
            {billingSummary?.lowBalance ? <AlertTriangle className="w-4 h-4" /> : <Wallet className="w-4 h-4" />}
            <span>{(billingSummary?.availableCredits || 0).toFixed(1)} CR</span>
            {(billingSummary?.reservedCredits || 0) > 0 && <span className="text-orange-300">R {(billingSummary?.reservedCredits || 0).toFixed(1)}</span>}
          </button>
          <div className="flex items-center gap-1 bg-[#111] border border-[#222] p-1 rounded">
             <button onClick={() => setMainView('map')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors ${mainView === 'map' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Map</button>
             <button onClick={() => setMainView('split')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors hidden md:block ${mainView === 'split' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Split</button>
             <button onClick={() => setMainView('chat')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors ${mainView === 'chat' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Chat</button>
          </div>
          <button 
            onClick={() => setIsMainMenu(true)}
            className="flex items-center gap-2 text-[#555] hover:text-white transition-colors xl:border-l border-[#333] xl:pl-8"
          >
            <ChevronLeft className="w-5 h-5 md:w-4 md:h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold hidden md:inline">Menu</span>
          </button>
          <button 
            onClick={() => handleResetGame()}
            className="flex items-center gap-2 text-[#555] hover:text-red-500 transition-colors border-l border-[#333] pl-4 md:pl-8"
            title="Сбросить прогресс игры"
          >
            <RotateCcw className="w-5 h-5 md:w-4 md:h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold hidden md:inline">Reset</span>
          </button>
          
          <div className="flex items-center border-l border-[#333] ml-4 md:ml-8 pl-4 md:pl-8 gap-2 md:gap-4">
            <button 
              onClick={handleSaveGameLocal}
              className="flex items-center gap-2 text-[#555] hover:text-white transition-colors"
              title="Сохранить в браузер"
            >
              <Save className="w-5 h-5 md:w-4 md:h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold hidden lg:inline">Save</span>
            </button>
            <button 
              onClick={handleLoadGameLocal}
              className="flex items-center gap-2 text-[#555] hover:text-white transition-colors"
              title="Загрузить из браузера"
            >
              <Upload className="w-5 h-5 md:w-4 md:h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold hidden lg:inline">Load</span>
            </button>
            <button 
              onClick={handleExportGameFile}
              className="flex items-center gap-2 text-[#555] hover:text-white transition-colors"
              title="Экспорт в файл"
            >
              <Download className="w-5 h-5 md:w-4 md:h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold hidden xl:inline">Export</span>
            </button>
            <button 
              onClick={handleImportGameFile}
              className="flex items-center gap-2 text-[#555] hover:text-white transition-colors"
              title="Импорт из файла"
            >
              <Upload className="w-5 h-5 md:w-4 md:h-4 rotate-180" />
              <span className="text-[10px] uppercase tracking-widest font-bold hidden xl:inline">Import</span>
            </button>
          </div>

          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 text-[#555] hover:text-white transition-colors border-l border-[#333] pl-4 md:pl-8"
          >
            <Settings className="w-5 h-5 md:w-4 md:h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold hidden md:inline">Settings</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar: Config */}
        <aside className="w-full md:w-[350px] border-r border-[#333] flex flex-col bg-[#080808] shrink-0 order-2 md:order-1 h-1/2 md:h-auto overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 border-b border-[#333]">
              <h2 className="text-xs font-bold text-[#777] mb-4 uppercase tracking-widest flex items-center gap-2">
                Viral Profile
              </h2>
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#555]">Start Date</label>
                  <input
                    type="date"
                    className="w-full bg-[#0A0A0A] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors disabled:opacity-50"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-[#111] border-t border-[#333] shrink-0">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase text-[#555]">Period Step</label>
              <select
                className="w-full bg-[#0A0A0A] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors disabled:opacity-50"
                value={stepAmount}
                onChange={(e) => setStepAmount(e.target.value)}
                disabled={isSimulating}
              >
                <option value="1 день">1 день</option>
                <option value="3 дня">3 дня</option>
                <option value="1 неделя">1 неделя</option>
                <option value="1 месяц">1 месяц</option>
                <option value="1 год">1 год</option>
              </select>
              <label className="text-[10px] uppercase text-[#555]">Event Frequency</label>
              <select
                className="w-full bg-[#0A0A0A] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors disabled:opacity-50"
                value={eventFrequency}
                onChange={(e) => setEventFrequency(e.target.value)}
                disabled={isSimulating}
              >
                <option value="30 минут">Каждые 30 минут</option>
                <option value="1 час">Каждый 1 час</option>
                <option value="3 часа">Каждые 3 часа</option>
                <option value="5 часов">Каждые 5 часов</option>
              </select>
              <button
                onClick={startSimulationStep}
                disabled={isSimulating}
                className="w-full mt-2 py-3 bg-red-950 border border-red-600 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-900 transition-colors disabled:opacity-50"
              >
                {isSimulating ? 'Симуляция...' : parsedEvents.length > 0 ? 'Advance Time' : 'Initiate Leak'}
              </button>
            </div>
          </div>
        </aside>

        {/* Center: Content (Map + Images) */}
        {(mainView === 'split' || mainView === 'map') && (
          <div className="flex-1 relative bg-[#030303] flex items-center justify-center overflow-hidden order-1 md:order-2 h-1/2 md:h-auto z-0 flex-col">
            <div className="absolute inset-0 opacity-10 pointer-events-none z-10" style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
            
            <div className={`w-full ${imageMode === 'off' ? 'h-full' : 'h-1/2'} relative bg-[#0a0a0a] border-b border-[#333]`}>
               <Suspense fallback={<LoadingUI />}>
               <MapView 
                 location={location} 
                 setLocation={setLocation} 
                 mapData={currentDayMapData} 
                 showOverlay={showMapOverlay} 
                 isLocked={isSimulating || parsedEvents.length > 0}
               />
               </Suspense>
               {/* Map overlay toggle */}
               <button
                 onClick={() => setShowMapOverlay(prev => !prev)}
                 className={`absolute top-4 right-4 z-[1000] flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold border transition-colors ${
                   showMapOverlay 
                     ? 'bg-red-950/80 border-red-900/50 text-red-400 hover:bg-red-900/80' 
                     : 'bg-black/60 border-[#333] text-[#555] hover:text-[#888]'
                 }`}
               >
                 {showMapOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                 {showMapOverlay ? 'Overlay: ON' : 'Overlay: OFF'}
               </button>
               <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] w-[min(92vw,560px)] -translate-x-1/2 md:bottom-4">
                 <div className="relative overflow-hidden border border-cyan-300/70 bg-[#06141b]/88 shadow-[0_0_24px_rgba(34,211,238,0.16),inset_0_0_26px_rgba(34,211,238,0.08)] backdrop-blur-sm [clip-path:polygon(0_0,92%_0,100%_24%,100%_100%,4%_100%,0_76%)]">
                   <div className="absolute inset-x-0 top-0 h-px bg-cyan-100/75" />
                   <div className="absolute inset-0 opacity-20 [background:repeating-linear-gradient(0deg,transparent_0,transparent_4px,rgba(125,211,252,0.28)_5px)]" />
                   <div
                     className="relative grid divide-x divide-cyan-300/35"
                     style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(activeScenarioCounters.length, 1), 4)}, minmax(0, 1fr))` }}
                   >
                     {activeScenarioCounters.slice(0, 4).map((counter, index) => {
                       const CounterIcon = index === 0 ? Biohazard : index === 1 ? Skull : Dna;
                       return (
                         <div key={counter.id || counter.key} className="flex min-w-0 items-center gap-3 px-3 py-3 md:px-5">
                           <CounterIcon className="h-7 w-7 shrink-0 text-cyan-100 drop-shadow-[0_0_8px_rgba(165,243,252,0.65)]" strokeWidth={1.7} />
                           <div className="min-w-0">
                             <div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/82">{counter.label}</div>
                             <div className="text-2xl font-bold leading-none text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.35)] md:text-3xl">
                               {formatCounter(outbreakCounters[counter.key] || 0)}
                             </div>
                           </div>
                         </div>
                       );
                     })}
                   </div>
                   <div className="absolute bottom-2 left-5 right-5 h-[3px] border border-cyan-200/55 bg-cyan-500/25">
                     <div className="h-full w-full bg-gradient-to-r from-cyan-500/30 via-cyan-200/80 to-cyan-500/30" />
                   </div>
                 </div>
               </div>
            </div>

            {imageMode !== 'off' && (
              <div className="w-full h-1/2 p-4 flex flex-col justify-center items-center relative overflow-hidden bg-[#0A0A0A]">
                 <h2 className="absolute top-4 left-4 text-[10px] uppercase text-[#555] tracking-widest z-20 font-bold bg-black/60 px-2 py-1 rounded">Drone Visual Reconnaissance</h2>
                 {isImageGenerating ? (
                   <div className="flex flex-col items-center justify-center text-orange-500 animate-pulse">
                      <Loader2 className="w-8 h-8 animate-spin mb-2" />
                      <span className="text-xs uppercase tracking-widest">Generating Visual Data ({imageModel})...</span>
                   </div>
                 ) : (
                   currentEvent && images[currentEvent.day] ? (
                     <img 
                       src={images[currentEvent.day]} 
                       alt="City visual" 
                       className="w-full h-full object-cover rounded border border-[#222] shadow-[0_0_30px_rgba(255,100,0,0.1)] transition-all duration-500 z-10" 
                     />
                   ) : currentEvent && imagePrompts[currentEvent.day] ? (
                     <div className="flex flex-col items-center justify-center w-full h-full p-8 z-10 overflow-y-auto">
                        <span className="text-[#A3A3A3] text-xs font-bold uppercase mb-4 tracking-widest">Final Prompt For Manual Generation</span>
                        <textarea 
                           className="w-full max-w-2xl h-48 bg-[#111] p-4 text-[#E0E0E0] border border-[#333] focus:outline-none focus:border-[#555] rounded resize-none"
                           readOnly
                           value={imagePrompts[currentEvent.day]}
                        />
                     </div>
                   ) : (
                     <div className="flex flex-col items-center justify-center text-[#333]">
                        <ImageIcon className="w-12 h-12 mb-2" />
                        <span className="text-[10px] uppercase tracking-widest text-[#555]">
                          No visual data for current day
                        </span>
                     </div>
                   )
                 )}
              </div>
            )}
          </div>
        )}

        {/* Right: Timeline Log */}
        {(mainView === 'split' || mainView === 'chat') && (
          <aside className={`w-full ${mainView === 'split' ? 'md:w-[400px]' : 'flex-1'} border-l border-[#333] flex flex-col bg-[#080808] shrink-0 order-3 h-1/2 md:h-auto`}>
          <div className="p-4 border-b border-[#333] bg-[#0A0A0A] flex items-center justify-between">
            <h2 className="text-xs font-bold text-[#777] uppercase tracking-widest">Timeline Log</h2>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-[#111] border border-[#222] rounded px-1 hidden sm:flex">
                 <button onClick={() => setTextScale(s => Math.max(0.5, Number((s - 0.1).toFixed(1))))} className="px-1.5 py-0.5 text-[#555] hover:text-white transition-colors text-[10px] font-bold" title="Уменьшить шрифт">A-</button>
                 <span className="text-[9px] text-[#555] w-6 text-center">{Math.round(textScale * 100)}%</span>
                 <button onClick={() => setTextScale(s => Math.min(2.0, Number((s + 0.1).toFixed(1))))} className="px-1.5 py-0.5 text-[#555] hover:text-white transition-colors text-[10px] font-bold" title="Увеличить шрифт">A+</button>
              </div>

              {/* Day controls */}
              {parsedEvents.length > 0 && (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSelectedDayIndex(Math.max(0, selectedDayIndex - 1))}
                    disabled={selectedDayIndex <= 0}
                    className="p-1 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-orange-500 min-w-[3rem] text-center">
                    D{parsedEvents[selectedDayIndex]?.day ?? '-'}
                  </span>
                  <button 
                    onClick={() => setSelectedDayIndex(Math.min(parsedEvents.length - 1, selectedDayIndex + 1))}
                    disabled={selectedDayIndex >= parsedEvents.length - 1}
                    className="p-1 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto relative flex flex-col gap-4" style={{ zoom: textScale } as any}>
            {parsedEvents.length === 0 && !isSimulating && !timeline && (
              <div className="flex gap-3 text-[11px]">
                <span className="text-[#555] whitespace-nowrap">T - 00:00</span>
                <p className="text-[#555] italic">Awaiting initial human contact reports... Select Date & Step to "Initiate Leak".</p>
              </div>
            )}
            
            {(parsedEvents.length === 0 && timeline) && (
               <div className="markdown-body whitespace-pre-wrap prose prose-invert prose-p:my-2 prose-sm max-w-none prose-strong:text-orange-500 timeline-glow text-[#A3A3A3] text-[11px]">
                 <Suspense fallback={<Loader2 className="w-4 h-4 animate-spin" />}>
                 <ReactMarkdown>{timeline}</ReactMarkdown>
                 </Suspense>
               </div>
            )}

            {parsedEvents.length > 0 && selectedDayIndex >= 0 && parsedEvents[selectedDayIndex] && (
              <div className="flex gap-3 text-[11px] leading-relaxed transition-opacity duration-300 opacity-100">
                 <span className="whitespace-nowrap font-bold mt-[2px] w-12 shrink-0 text-orange-500">T + {parsedEvents[selectedDayIndex].day}d</span>
                 <div className="flex flex-col w-full">
                   <span className="text-[9px] uppercase text-[#777] mb-1 tracking-wider">{parsedEvents[selectedDayIndex].dateStr}</span>
                   <div className="markdown-body whitespace-pre-wrap prose prose-invert prose-p:my-1 prose-sm max-w-none text-[11px] leading-relaxed text-[#E0E0E0]">
                     <Suspense fallback={<Loader2 className="w-4 h-4 animate-spin" />}>
                     <ReactMarkdown>{displayTimelineText}</ReactMarkdown>
                     </Suspense>
                   </div>
                 </div>
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>

          <div className="p-4 h-24 border-t border-[#333] flex flex-col justify-center gap-2 bg-[#0A0A0A]">
            <div className="h-1 bg-[#1A1A1A] w-full relative">
              <div 
                className="absolute left-0 top-0 h-full bg-orange-500 transition-all duration-[300ms]" 
                style={{ width: parsedEvents.length > 0 ? `${Math.max(2, ((selectedDayIndex + 1) / parsedEvents.length) * 100)}%` : (isSimulating ? '90%' : '2%') }}>
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[#555] uppercase">
              <span>Start</span>
              <span className="text-orange-500">Timeline Progress</span>
              <span>End</span>
            </div>
          </div>
          </aside>
        )}
      </main>

      <footer className="min-h-12 border-t border-[#333] flex items-center justify-between gap-3 px-2 md:px-4 bg-[#0A0A0A] text-[9px] uppercase tracking-tighter shrink-0">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <button
            onClick={() => {
              setDiseaseTab('overview');
              setIsDiseaseWindowOpen(true);
            }}
            className="disease-hud-button"
            aria-label="Открыть окно болезни"
          >
            <span className="disease-hud-title">Мутации</span>
            <span className="disease-hud-value">
              <Dna className="h-5 w-5" strokeWidth={1.7} />
              <span>{mutationPoints}</span>
            </span>
          </button>
          <span className="hidden md:inline">User: {currentUsername.toUpperCase()}</span>
          <span className="hidden md:inline">Security: LEVEL 5</span>
          <span className="hidden lg:inline text-green-800">Link: SECURE_128-BIT</span>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1 text-[#555] hover:text-red-500 transition-colors cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            <span>Выход</span>
          </button>
        </div>
        <div className="hidden lg:flex gap-4">
          {billingSummary?.lowBalance ? (
            <span className="text-orange-400 font-bold">LOW CREDIT BALANCE / ПОПОЛНИТЕ БАЛАНС</span>
          ) : (
            <span className="text-red-900 font-bold">SIMULATION IS FOR MILITARY PURPOSES ONLY</span>
          )}
        </div>
      </footer>
        </>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0A0A0A] border border-[#333] p-6 w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,0.8)] relative">
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-[#555] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold text-white mb-6 uppercase tracking-widest flex items-center gap-2">
              <Settings className="w-4 h-4 text-orange-500" /> System Preferences
            </h2>
            
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-[#555]">Text AI Provider</label>
                <select 
                  className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors"
                  value={textProvider}
                  onChange={e => {
                    const newProvider = e.target.value as any;
                    setTextProvider(newProvider);
                    if (newProvider === 'gemini') setTextModel('gemini-3.1-pro-preview');
                    else if (newProvider === 'openai') setTextModel('gpt-5.5');
                    else if (newProvider === 'openrouter') setTextModel('anthropic/claude-3.5-sonnet');
                  }}
                  disabled={isSimulating}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              {textProvider === 'gemini' && (
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] uppercase text-[#555]">Gemini API Key</label>
                   <input 
                     type="password" 
                     value={geminiKey} 
                     onChange={e => setGeminiKey(e.target.value)} 
                     className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" 
                     placeholder="AIza..." 
                     disabled={isSimulating}
                   />
                   <span className="text-[9px] text-[#555]">Required for Gemini. Get a key at aistudio.google.com</span>
                 </div>
              )}

              {textProvider === 'openai' && (
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] uppercase text-[#555]">OpenAI API Key</label>
                   <input 
                     type="password" 
                     value={openAiKey} 
                     onChange={e => setOpenAiKey(e.target.value)} 
                     className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" 
                     placeholder="sk-..." 
                     disabled={isSimulating}
                   />
                 </div>
              )}

              {textProvider === 'openrouter' && (
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] uppercase text-[#555]">OpenRouter API Key</label>
                   <input 
                     type="password" 
                     value={openRouterKey} 
                     onChange={e => setOpenRouterKey(e.target.value)} 
                     className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" 
                     placeholder="sk-or-v1-..." 
                     disabled={isSimulating}
                   />
                 </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-[#555]">Text AI Model</label>
                {textProvider === 'gemini' && (
                  <select value={textModel} onChange={e => setTextModel(e.target.value)} className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" disabled={isSimulating}>
                     <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                     <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
                     <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Preview)</option>
                     <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                     <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                     <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  </select>
                )}
                {textProvider === 'openai' && (
                  <select value={textModel} onChange={e => setTextModel(e.target.value)} className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" disabled={isSimulating}>
                    <optgroup label="── GPT-5 Series ──">
                      <option value="gpt-5.5">GPT-5.5 (Flagship)</option>
                      <option value="gpt-5.5-pro">GPT-5.5 Pro</option>
                      <option value="gpt-5.4">GPT-5.4</option>
                      <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                      <option value="gpt-5.4-nano">GPT-5.4 Nano</option>
                      <option value="gpt-5.3">GPT-5.3</option>
                      <option value="gpt-5.3-instant">GPT-5.3 Instant</option>
                    </optgroup>
                    <optgroup label="── Reasoning (o-Series) ──">
                      <option value="o3">o3</option>
                      <option value="o3-pro">o3 Pro</option>
                      <option value="o3-mini">o3 Mini</option>
                    </optgroup>
                    <optgroup label="── Legacy (API only) ──">
                      <option value="gpt-4o">GPT-4o (Legacy)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (Legacy)</option>
                      <option value="gpt-4.1">GPT-4.1 (Legacy)</option>
                      <option value="o1-preview">o1 Preview (Legacy)</option>
                      <option value="o4-mini">o4 Mini (Legacy)</option>
                    </optgroup>
                  </select>
                )}
                {textProvider === 'openrouter' && (
                  <div className="flex flex-col gap-1">
                    <input 
                      type="text" 
                      value={textModel} 
                      onChange={e => setTextModel(e.target.value)} 
                      className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" 
                      placeholder="anthropic/claude-3.5-sonnet" 
                      disabled={isSimulating}
                    />
                    <span className="text-[9px] text-[#555]">Enter model ID (e.g., anthropic/claude-3.5-sonnet, meta-llama/llama-3-8b-instruct)</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1 pt-4 border-t border-[#333]">
                <label className="text-[10px] uppercase text-[#555]">Map Overlay (Infected)</label>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowMapOverlay(true)} 
                    className={`flex-1 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${showMapOverlay ? 'bg-red-950 border-red-600 text-red-400' : 'bg-[#111] border-[#222] text-[#555] hover:text-[#888]'}`}
                  >
                    Показать
                  </button>
                  <button 
                    onClick={() => setShowMapOverlay(false)} 
                    className={`flex-1 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${!showMapOverlay ? 'bg-red-950 border-red-600 text-red-400' : 'bg-[#111] border-[#222] text-[#555] hover:text-[#888]'}`}
                  >
                    Скрыть
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1 pt-4 border-t border-[#333]">
                <label className="text-[10px] uppercase text-[#555]">Visual Generation Mode</label>
                <select value={imageMode} onChange={e => setImageMode(e.target.value as any)} className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" disabled={isSimulating}>
                  <option value="on">API Generation (On)</option>
                  <option value="prompt">Show Final Prompt Only</option>
                  <option value="off">Off</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-[#555]">Image AI Model</label>
                <select value={imageModel} onChange={e => setImageModel(e.target.value)} className="w-full bg-[#111] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors" disabled={isSimulating}>
                  <option value="gemini-3.1-flash-image-preview">Nano Banana 2 (Preview)</option>
                  <option value="gemini-3.1-flash-image">Gemini 3.1 Image</option>
                  <option value="imagen-3.0-generate-002">Imagen 3.0</option>
                  <option value="gpt-image-2">GPT Image 2 (OpenAI)</option>
                  <option value="dall-e-3">DALL-E 3 (Legacy)</option>
                </select>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Disease Management Modal */}
      {isDiseaseWindowOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="bg-[#0A0A0A] border border-red-900/50 w-full max-w-4xl h-[85vh] flex flex-col shadow-[0_0_100px_rgba(255,0,0,0.15)] relative overflow-hidden">
            <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#ff0000 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
            
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#333] bg-[#0d0d0d] relative z-10">
              <div className="flex items-center gap-3">
                <Biohazard className="w-6 h-6 text-red-600 animate-pulse" />
                <h2 className="text-lg font-bold text-white uppercase tracking-tighter">Управление Вирусом</h2>
              </div>
              <button 
                onClick={() => setIsDiseaseWindowOpen(false)}
                className="text-[#555] hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#333] bg-[#080808] relative z-10">
              <button 
                onClick={() => setDiseaseTab('overview')}
                className={`px-6 py-4 text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${diseaseTab === 'overview' ? 'bg-[#1a0505] text-red-500 border-b-2 border-red-600' : 'text-[#555] hover:text-[#A3A3A3]'}`}
              >
                <Dna className="w-4 h-4" />
                Обзор и Мутация
              </button>
              <button 
                onClick={() => setDiseaseTab('phases')}
                className={`px-6 py-4 text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${diseaseTab === 'phases' ? 'bg-[#1a0505] text-red-500 border-b-2 border-red-600' : 'text-[#555] hover:text-[#A3A3A3]'}`}
              >
                <Microscope className="w-4 h-4" />
                Фазы Вируса
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-[#050505] relative z-10">
              {diseaseTab === 'overview' ? (
                <div className="space-y-8">
                  {/* MP Display */}
                  <div className="flex items-center justify-between bg-[#0A0A0A] border border-red-900/30 p-4 rounded shadow-inner">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-red-950/40 rounded border border-red-900/50">
                        <Dna className="w-6 h-6 text-red-500" />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-[#555] tracking-widest">Доступно очков мутации</p>
                        <p className="text-2xl font-bold text-white tracking-tighter">{mutationPoints} ОМ</p>
                      </div>
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] uppercase text-[#555] tracking-widest">Активных мутаций</p>
                       <p className="text-xl font-bold text-red-500">{activeMutations.length}</p>
                    </div>
                  </div>

                  {/* Proposal Input */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-[#222] pb-2">
                       <h3 className="text-sm font-bold text-white uppercase tracking-widest">Новая Мутация</h3>
                       <span className="text-[9px] text-[#555] uppercase">Опишите желаемое изменение вируса</span>
                    </div>
                    
                    <div className="relative">
                      <textarea
                        className="w-full bg-[#080808] border border-[#222] p-4 text-sm text-[#E0E0E0] focus:outline-none focus:border-red-900/50 transition-colors min-h-[120px] resize-none"
                        placeholder="Например: Зомби становятся устойчивы к холоду и могут действовать в арктических условиях..."
                        value={mutationProposal}
                        onChange={(e) => setMutationProposal(e.target.value)}
                        disabled={isEvaluating}
                      />
                      {isEvaluating && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-red-500 gap-2">
                           <Loader2 className="w-6 h-6 animate-spin" />
                           <span className="text-[10px] uppercase tracking-widest">Гейм-Мастер оценивает предложение...</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-3">
                      {evaluationResult && (
                        <button
                          onClick={() => setEvaluationResult(null)}
                          className="px-4 py-2 text-[10px] uppercase font-bold text-[#555] hover:text-white transition-colors"
                        >
                          Сброс
                        </button>
                      )}
                      <button
                        onClick={handleEvaluateMutation}
                        disabled={isEvaluating || !mutationProposal.trim()}
                        className="px-6 py-2 bg-red-950/30 border border-red-900/50 text-red-500 text-[10px] uppercase font-bold hover:bg-red-900/50 transition-colors disabled:opacity-30"
                      >
                        Оценить стоимость
                      </button>
                    </div>
                  </div>

                  {/* Evaluation Result */}
                  {evaluationResult && (
                    <div className={`p-6 border ${evaluationResult.approved ? 'border-green-900/50 bg-green-950/10' : 'border-red-900/50 bg-red-950/10'} rounded animate-in fade-in slide-in-from-top-4`}>
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="text-[10px] uppercase text-[#555] tracking-widest mb-1">Вердикт Мастера</p>
                          <h4 className={`text-lg font-bold uppercase ${evaluationResult.approved ? 'text-green-500' : 'text-red-500'}`}>
                            {evaluationResult.approved ? evaluationResult.name : 'Отклонено'}
                          </h4>
                        </div>
                        {evaluationResult.approved && (
                          <div className="text-right">
                            <p className="text-[10px] uppercase text-[#555] tracking-widest mb-1">Стоимость</p>
                            <p className="text-xl font-bold text-white">{evaluationResult.cost} ОМ</p>
                          </div>
                        )}
                      </div>
                      <p className="text-xs italic leading-relaxed text-[#A3A3A3] mb-6">"{evaluationResult.reason}"</p>
                      
                      {evaluationResult.approved && (
                        <button
                          onClick={handleApplyMutation}
                          disabled={mutationPoints < evaluationResult.cost}
                          className="w-full py-3 bg-green-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-green-500 transition-colors disabled:opacity-30 disabled:grayscale shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                        >
                          {mutationPoints < evaluationResult.cost ? 'Недостаточно очков' : 'Внедрить мутацию в геном'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active Mutations List */}
                  <div className="space-y-4 pt-4 border-t border-[#222]">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Активные мутации</h3>
                    {activeMutations.length === 0 ? (
                      <div className="py-8 flex flex-col items-center justify-center border border-dashed border-[#222] opacity-30">
                        <Dna className="w-8 h-8 mb-2" />
                        <p className="text-[10px] uppercase tracking-widest">Геном стабилен. Мутаций нет.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeMutations.map((m) => (
                          <div key={m.id} className="p-4 bg-[#0A0A0A] border border-red-900/20 rounded group hover:border-red-900/50 transition-colors relative">
                            <button
                              onClick={() => handleRemoveMutation(m.id)}
                              className="absolute top-3 right-3 p-1.5 text-[#333] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              title="Откатить мутацию"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <div className="flex items-center justify-between mb-2 pr-6">
                              <span className="text-xs font-bold text-red-500 uppercase">{m.name}</span>
                              <span className="text-[9px] text-[#555] uppercase">День {m.dayApplied}</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-[#888]">{m.description}</p>
                            <div className="mt-2 text-[9px] text-red-900/60 uppercase font-bold">Возврат: {m.cost} ОМ</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-[#222] pb-4">
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-widest">Матрица Симптомов</h3>
                      <p className="text-[10px] text-[#555] uppercase mt-1">Определение этапов развития патогена</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const newId = `phase_${Date.now()}`;
                          setSymptomPhases(prev => [...prev, { id: newId, name: `Phase ${prev.length + 1}`, dayRange: 'D?', description: 'Описание фазы...', color: 'green' }]);
                          setEditingPhaseId(newId);
                        }}
                        disabled={isSimulating || parsedEvents.length > 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-950/30 border border-green-900/50 text-green-500 text-[10px] uppercase font-bold hover:bg-green-900/50 transition-colors disabled:opacity-30"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Добавить фазу
                      </button>
                      <button
                        onClick={() => { setSymptomPhases(DEFAULT_SYMPTOM_PHASES); setEditingPhaseId(null); }}
                        disabled={isSimulating || parsedEvents.length > 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-orange-950/30 border border-orange-900/50 text-orange-500 text-[10px] uppercase font-bold hover:bg-orange-900/50 transition-colors disabled:opacity-30"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Сброс
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {symptomPhases.map((phase) => {
                      const colorMap: Record<string, { bar: string; text: string; border: string; bg: string }> = {
                        blue:   { bar: 'bg-blue-900',   text: 'text-blue-400',   border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                        yellow: { bar: 'bg-yellow-900',  text: 'text-yellow-500', border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                        red:    { bar: 'bg-red-600',     text: 'text-red-500',    border: 'border-red-900',   bg: 'bg-[#120505]' },
                        green:  { bar: 'bg-green-900',   text: 'text-green-400',  border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                        purple: { bar: 'bg-purple-900',  text: 'text-purple-400', border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                        orange: { bar: 'bg-orange-900',  text: 'text-orange-400', border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                        cyan:   { bar: 'bg-cyan-900',    text: 'text-cyan-400',   border: 'border-[#222]',    bg: 'bg-[#0A0A0A]' },
                      };
                      const c = colorMap[phase.color] || colorMap.blue;
                      const isEditing = editingPhaseId === phase.id;
                      const canEdit = !isSimulating && parsedEvents.length === 0;

                      return (
                        <div key={phase.id} className={`p-4 border ${c.border} ${c.bg} group transition-all duration-200 ${isEditing ? 'ring-1 ring-orange-800/50' : ''} relative`}>
                          {isEditing && canEdit ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <input
                                  className="flex-1 bg-[#111] border border-[#333] px-3 py-2 text-xs uppercase text-white focus:outline-none focus:border-orange-800"
                                  value={phase.name}
                                  onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, name: e.target.value } : p))}
                                  placeholder="Название"
                                />
                                <input
                                  className="w-20 bg-[#111] border border-[#333] px-3 py-2 text-xs uppercase text-white focus:outline-none focus:border-orange-800"
                                  value={phase.dayRange}
                                  onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, dayRange: e.target.value } : p))}
                                  placeholder="D1-2"
                                />
                              </div>
                              <textarea
                                className="w-full bg-[#111] border border-[#333] px-3 py-2 text-[12px] text-[#A3A3A3] focus:outline-none focus:border-orange-800 resize-none leading-relaxed"
                                rows={3}
                                value={phase.description}
                                onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, description: e.target.value } : p))}
                                placeholder="Описание симптомов..."
                              />
                              <div className="flex items-center justify-between">
                                <div className="flex gap-1.5">
                                  {(['blue', 'yellow', 'red', 'green', 'purple', 'orange', 'cyan'] as const).map(clr => (
                                    <button
                                      key={clr}
                                      onClick={() => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, color: clr } : p))}
                                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                                        phase.color === clr ? 'border-white scale-110' : 'border-[#333] hover:border-[#555]'
                                      }`}
                                      style={{ backgroundColor: { blue: '#1e3a5f', yellow: '#5f4a1e', red: '#5f1e1e', green: '#1e5f3a', purple: '#3a1e5f', orange: '#5f3a1e', cyan: '#1e4a5f' }[clr] }}
                                    />
                                  ))}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setSymptomPhases(prev => prev.filter(p => p.id !== phase.id))}
                                    className="p-1.5 text-red-900 hover:text-red-500 transition-colors"
                                    title="Удалить"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setEditingPhaseId(null)}
                                    className="p-1.5 text-green-900 hover:text-green-500 transition-colors"
                                    title="Готово"
                                  >
                                    <Check className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`${canEdit ? 'cursor-pointer' : ''}`}
                              onClick={() => canEdit && setEditingPhaseId(phase.id)}
                            >
                              <div className="flex items-center gap-3 mb-2">
                                <div className={`w-1 h-4 ${c.bar}`}></div>
                                <span className={`text-xs font-bold uppercase ${c.text} flex-1`}>{phase.name} ({phase.dayRange})</span>
                                {canEdit && (
                                  <Pencil className="w-3.5 h-3.5 text-[#333] group-hover:text-[#666] transition-colors" />
                                )}
                              </div>
                              <p className="text-xs leading-relaxed text-[#A3A3A3]">{phase.description}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {symptomPhases.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-[#222]">
                      <p className="text-xs text-[#555] italic uppercase tracking-widest">Фазы не определены</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Footer decoration */}
            <div className="h-1 bg-red-900/20 w-full">
              <div className="h-full bg-red-600 w-1/3"></div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[3000] flex flex-col gap-2 pointer-events-none w-full max-w-md px-4">
        {notifications.map(n => (
          <div 
            key={n.id} 
            className={`pointer-events-auto flex items-start gap-4 p-4 rounded-sm border shadow-2xl notification-animate min-w-[320px] ${
              n.type === 'error' ? 'bg-red-950/95 border-red-500 text-red-100 shadow-red-900/40' : 
              n.type === 'warning' ? 'bg-orange-950/95 border-orange-500 text-orange-100 shadow-orange-900/40' : 
              'bg-[#0A0A0A]/95 border-blue-600 text-blue-100 shadow-blue-900/40'
            }`}
          >
            <div className={`p-2 rounded ${
              n.type === 'error' ? 'bg-red-900/30 text-red-500' : 
              n.type === 'warning' ? 'bg-orange-900/30 text-orange-500' : 
              'bg-blue-900/30 text-blue-500'
            }`}>
              {n.type === 'error' ? <Skull className="w-5 h-5" /> : 
               n.type === 'warning' ? <Biohazard className="w-5 h-5" /> : 
               <Microscope className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
               <div className="flex items-center justify-between mb-1">
                 <span className={`text-[9px] uppercase font-black tracking-[0.25em] ${
                   n.type === 'error' ? 'text-red-500' : n.type === 'warning' ? 'text-orange-500' : 'text-blue-500'
                 }`}>
                   {n.type === 'error' ? 'Critical Error' : n.type === 'warning' ? 'System Alert' : 'Simulation Update'}
                 </span>
                 <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></div>
               </div>
               <p className="text-[11px] font-bold uppercase tracking-tight leading-snug opacity-90">{n.message}</p>
            </div>
          </div>
        ))}
      </div>
      </Suspense>
    </div>
  );
}
