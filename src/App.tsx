import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MapView } from './components/MapView';
import { AuthScreen } from './components/AuthScreen';
import { simulateOutbreakStepStream, generateCityImage, buildCityImagePrompt } from './lib/gemini';
import { getSessionUsername, getUserSettings, saveUserSettings, logoutUser, type UserSettings, type SymptomPhase, DEFAULT_SYMPTOM_PHASES, type Scenario, DEFAULT_SCENARIOS } from './lib/auth';
import ReactMarkdown from 'react-markdown';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Settings, X, LogOut, Eye, EyeOff, Pencil, Plus, Trash2, Check, RotateCcw } from 'lucide-react';

interface TimelineEvent {
  day: number;
  dateStr: string;
  text: string;
  raw: string;
  mapData?: any;
}

export default function App() {
  const [isAuthed, setIsAuthed] = useState(() => !!getSessionUsername());
  const [currentUsername, setCurrentUsername] = useState(() => getSessionUsername() || '');

  const handleAuthSuccess = useCallback(() => {
    setIsAuthed(true);
    setCurrentUsername(getSessionUsername() || '');
    // Load saved settings
    const saved = getUserSettings();
    setTextProvider(saved.textProvider);
    setTextModel(saved.textModel);
    setImageModel(saved.imageModel);
    setImageMode(saved.imageMode);
    setOpenAiKey(saved.openAiKey);
    setOpenRouterKey(saved.openRouterKey);
    setShowMapOverlay(saved.showMapOverlay);
    setSymptomPhases(saved.symptomPhases || DEFAULT_SYMPTOM_PHASES);
    setScenarios(saved.scenarios || DEFAULT_SCENARIOS);
    setSelectedScenarioId(saved.selectedScenarioId || 'default_zombie');
  }, []);

  const handleLogout = useCallback(() => {
    logoutUser();
    setIsAuthed(false);
    setCurrentUsername('');
  }, []);

  const [location, setLocation] = useState<[number, number]>([39.8283, -98.5795]); 
  const [startDate, setStartDate] = useState('1989-07-03');
  const [scenarios, setScenarios] = useState<Scenario[]>(() => getUserSettings().scenarios || DEFAULT_SCENARIOS);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(() => getUserSettings().selectedScenarioId || 'default_zombie');
  
  const activeScenario = useMemo(() => scenarios.find(s => s.id === selectedScenarioId) || scenarios[0] || DEFAULT_SCENARIOS[0], [scenarios, selectedScenarioId]);

  const updateActiveScenario = useCallback((field: keyof Scenario, value: string) => {
    setScenarios(prev => prev.map(s => s.id === selectedScenarioId ? { ...s, [field]: value } : s));
  }, [selectedScenarioId]);

  const handleAddScenario = useCallback(() => {
    const newId = `scen_${Date.now()}`;
    const newScenario: Scenario = {
      id: newId,
      name: 'Новый сценарий',
      preface: '',
      origin: '',
      symptoms: ''
    };
    setScenarios(prev => [...prev, newScenario]);
    setSelectedScenarioId(newId);
  }, []);

  const handleDeleteScenario = useCallback((id: string) => {
    setScenarios(prev => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter(s => s.id !== id);
      if (selectedScenarioId === id) setSelectedScenarioId(filtered[0].id);
      return filtered;
    });
  }, [selectedScenarioId]);
  
  const [timeline, setTimeline] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [stepAmount, setStepAmount] = useState('1 неделя');
  const [images, setImages] = useState<Record<number, string>>({});
  const [imagePrompts, setImagePrompts] = useState<Record<number, string>>({});
  const [mainView, setMainView] = useState<'split' | 'map' | 'chat'>('split');
  
  // Settings loaded from profile (lazy-init to avoid calling getUserSettings every render)
  const [imageMode, setImageMode] = useState<'on' | 'off' | 'prompt'>(() => getUserSettings().imageMode);
  const [textProvider, setTextProvider] = useState<'gemini' | 'openai' | 'openrouter'>(() => getUserSettings().textProvider);
  const [textModel, setTextModel] = useState(() => getUserSettings().textModel);
  const [imageModel, setImageModel] = useState(() => getUserSettings().imageModel);
  const [openAiKey, setOpenAiKey] = useState(() => getUserSettings().openAiKey);
  const [openRouterKey, setOpenRouterKey] = useState(() => getUserSettings().openRouterKey);
  const [showMapOverlay, setShowMapOverlay] = useState(() => getUserSettings().showMapOverlay);
  const [symptomPhases, setSymptomPhases] = useState<SymptomPhase[]>(() => getUserSettings().symptomPhases || DEFAULT_SYMPTOM_PHASES);
  const [textScale, setTextScale] = useState<number>(() => getUserSettings().textScale ?? 1.0);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Auto-save settings whenever they change
  useEffect(() => {
    if (!isAuthed) return;
    const settings: UserSettings = {
      textProvider, textModel, imageModel, imageMode,
      openAiKey, openRouterKey, showMapOverlay, symptomPhases, textScale,
      scenarios, selectedScenarioId
    };
    saveUserSettings(settings);
  }, [textProvider, textModel, imageModel, imageMode, openAiKey, openRouterKey, showMapOverlay, symptomPhases, textScale, scenarios, selectedScenarioId, isAuthed]);

  if (!isAuthed) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }
  
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const parsedEvents = useMemo(() => {
    const events: TimelineEvent[] = [];
    // Match DAY_X (Date): optionally with markdown bold, hashes, etc.
    const headerRegex = /(?:^|\n)[ \t]*(?:\*\*|###\s*|##\s*|#\s*)?DAY_(\d+)[ \t]*\(([^)]+)\)(?:\*\*|:|\*\*:|:\*\*|[ \t])*/g;
    
    const matches = Array.from(timeline.matchAll(headerRegex));

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const dayNum = parseInt(match[1], 10);
      const dateStr = match[2];
      
      const startIndex = match.index + match[0].length;
      const endIndex = i + 1 < matches.length ? matches[i + 1].index : timeline.length;
      
      let rawText = timeline.substring(startIndex, endIndex).trim();

      // Process MAP_DATA
      let mapData = undefined;
      const mapStartIndex = rawText.indexOf('[MAP_DATA:');
      if (mapStartIndex !== -1) {
        const jsonStart = rawText.indexOf('{', mapStartIndex);
        let mapEndIndex = rawText.lastIndexOf(']');

        if (mapEndIndex < mapStartIndex) {
          mapEndIndex = rawText.length;
        }

        if (jsonStart !== -1) {
          const jsonEnd = rawText.lastIndexOf('}');
          if (jsonEnd !== -1 && jsonEnd >= jsonStart) {
            const jsonStr = rawText.substring(jsonStart, jsonEnd + 1);
            try {
              mapData = JSON.parse(jsonStr);
              rawText = rawText.substring(0, mapStartIndex).trim() + '\n' + rawText.substring(mapEndIndex + 1).trim();
            } catch (e) {
              // silently ignore parse errors during streaming
            }
          }
        }
      }

      events.push({
        day: dayNum,
        dateStr: dateStr,
        text: rawText,
        mapData: mapData,
        raw: match[0] + rawText,
      });
    }

    // Use a Map to naturally deduplicate and keep the LAST occurrence.
    // This allows us to overwrite accidental early generations with their proper, detailed iterations.
    const latestEventsMap = new Map<number, TimelineEvent>();
    for (const ev of events) {
      latestEventsMap.set(ev.day, ev);
    }

    const deduped = Array.from(latestEventsMap.values());
    deduped.sort((a, b) => a.day - b.day);
    
    return deduped;
  }, [timeline]);

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(-1);

  useEffect(() => {
    if (isSimulating && parsedEvents.length > 0) {
      setSelectedDayIndex(parsedEvents.length - 1);
    }
  }, [parsedEvents.length, isSimulating]);

  const startSimulationStep = async () => {
    setIsSimulating(true);
    // If it's the first time, reset timeline. Otherwise, append
    if (parsedEvents.length === 0) setTimeline('');
    
    // Determine current elapsed context
    const elapsedDays = parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1].day : 0;
    const currentParsedDateStr = parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1].dateStr : startDate;

    try {
      const symptomDesc = symptomPhases.map(p => `${p.name} (${p.dayRange}): ${p.description}`).join('\n');
      const stream = simulateOutbreakStepStream({
        location: `${location[0].toFixed(4)}, ${location[1].toFixed(4)}`,
        startDate,
        scenario: `[Предисловие]: ${activeScenario.preface}\n[Начало/Причина]: ${activeScenario.origin}\n[Симптомы/Особенности]: ${activeScenario.symptoms}`,
        symptomDescription: symptomDesc,
        currentDate: currentParsedDateStr,
        elapsedDays,
        stepAmount,
        previousTimeline: timeline,
        textModel,
        textProvider,
        openAiKey,
        openRouterKey
      });

      let newTimelineChunk = "";
      for await (const chunk of stream) {
        setTimeline(prev => prev + chunk);
        newTimelineChunk += chunk;
      }

      // Check the newly parsed events from the chunk
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
                 const imgBase64 = await generateCityImage(newTimelineChunk, `${location[0].toFixed(2)}, ${location[1].toFixed(2)}`, imageModel, openAiKey);
                 setImages(prev => ({...prev, [lastDayInChunk]: imgBase64}));
              } catch (e: any) {
                 console.error("Image generation failed", e);
                 setTimeline(prev => prev + '\\n\\n*[Системное предупреждение: не удалось получить визуализацию с дрона: ' + e.message + ']*');
              } finally {
                 setIsImageGenerating(false);
              }
          } else if (imageMode === 'prompt') {
              const prompt = buildCityImagePrompt(newTimelineChunk, `${location[0].toFixed(2)}, ${location[1].toFixed(2)}`);
              setImagePrompts(prev => ({...prev, [lastDayInChunk]: prompt}));
          }
      }

    } catch (e: any) {
      setTimeline(prev => prev + '\n\n**[СИСТЕМНАЯ ОШИБКА]** ' + e.message);
    } finally {
      setIsSimulating(false);
    }
  };

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedDayIndex, timeline, images]);

  const accumulatedMapData = useMemo(() => {
    if (!parsedEvents || parsedEvents.length === 0 || selectedDayIndex < 0) return undefined;
    const result: any = { infected: [], movements: [], pois: [], perimeters: [] };
    
    for (let i = 0; i <= selectedDayIndex; i++) {
        const data = parsedEvents[i]?.mapData;
        if (data) {
            if (data.infected) result.infected = [...(result.infected || []), ...data.infected];
            if (data.movements) result.movements = [...(result.movements || []), ...data.movements];
            if (data.pois) result.pois = [...(result.pois || []), ...data.pois];
            if (data.perimeters) result.perimeters = [...(result.perimeters || []), ...data.perimeters];
        }
    }
    return result;
  }, [parsedEvents, selectedDayIndex]);

  const currentEvent = parsedEvents[selectedDayIndex];

  return (
    <div className="bg-[#050505] text-[#A3A3A3] w-full h-screen font-mono flex flex-col select-none">
      {/* Header */}
      <header className="h-16 border-b border-[#333] flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-3 h-3 rounded-full bg-red-600 animate-pulse"></div>
          <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white uppercase flex items-center gap-2">
            <span className="hidden sm:inline">PROJECT: </span>Z-SIM<span className="hidden sm:inline">ULATOR</span>
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
          <div className="flex items-center gap-1 bg-[#111] border border-[#222] p-1 rounded">
             <button onClick={() => setMainView('map')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors ${mainView === 'map' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Map</button>
             <button onClick={() => setMainView('split')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors hidden md:block ${mainView === 'split' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Split</button>
             <button onClick={() => setMainView('chat')} className={`px-2 md:px-3 py-1 text-[10px] uppercase font-bold transition-colors ${mainView === 'chat' ? 'bg-[#333] text-white' : 'text-[#555] hover:text-[#A3A3A3]'}`}>Chat</button>
          </div>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 text-[#555] hover:text-white transition-colors xl:border-l border-[#333] xl:pl-8"
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
                    onChange={e => setStartDate(e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />
                </div>
                
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase text-[#555]">Scenario / Сценарий</label>
                    <div className="flex gap-1">
                      <button onClick={handleAddScenario} disabled={isSimulating || parsedEvents.length > 0} className="p-1 text-[#555] hover:text-green-500 disabled:opacity-30"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => handleDeleteScenario(selectedScenarioId)} disabled={isSimulating || parsedEvents.length > 0 || scenarios.length <= 1} className="p-1 text-[#555] hover:text-red-500 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <select 
                    className="w-full bg-[#0A0A0A] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors disabled:opacity-50"
                    value={selectedScenarioId}
                    onChange={e => setSelectedScenarioId(e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  >
                    {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>

                  <input
                    type="text"
                    placeholder="Название сценария"
                    className="w-full bg-[#111] border border-[#333] p-2 text-[11px] text-white focus:outline-none focus:border-red-900 transition-colors"
                    value={activeScenario.name}
                    onChange={e => updateActiveScenario('name', e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />

                  <label className="text-[10px] uppercase text-[#555] mt-1">Preface / Предисловие</label>
                  <textarea
                    className="w-full h-16 bg-[#0A0A0A] border border-[#222] p-2 text-[11px] leading-relaxed text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors resize-none"
                    value={activeScenario.preface}
                    onChange={e => updateActiveScenario('preface', e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />

                  <label className="text-[10px] uppercase text-[#555] mt-1">Origin / Начало вируса</label>
                  <textarea
                    className="w-full h-20 bg-[#0A0A0A] border border-[#222] p-2 text-[11px] leading-relaxed text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors resize-none"
                    value={activeScenario.origin}
                    onChange={e => updateActiveScenario('origin', e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />

                  <label className="text-[10px] uppercase text-[#555] mt-1">Symptoms / Особенности вируса</label>
                  <textarea
                    className="w-full h-24 bg-[#0A0A0A] border border-[#222] p-2 text-[11px] leading-relaxed text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors resize-none"
                    value={activeScenario.symptoms}
                    onChange={e => updateActiveScenario('symptoms', e.target.value)}
                    disabled={isSimulating || parsedEvents.length > 0}
                  />
                </div>
              </div>
            </div>

            <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-[#777] uppercase tracking-widest">Symptom Matrix</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const newId = `phase_${Date.now()}`;
                    setSymptomPhases(prev => [...prev, { id: newId, name: `Phase ${prev.length + 1}`, dayRange: 'D?', description: 'Описание фазы...', color: 'green' }]);
                    setEditingPhaseId(newId);
                  }}
                  disabled={isSimulating || parsedEvents.length > 0}
                  className="p-1 text-[#555] hover:text-green-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Добавить фазу"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setSymptomPhases(DEFAULT_SYMPTOM_PHASES); setEditingPhaseId(null); }}
                  disabled={isSimulating || parsedEvents.length > 0}
                  className="p-1 text-[#555] hover:text-orange-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Сбросить к стандартным"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
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
                  <div key={phase.id} className={`p-2 border ${c.border} ${c.bg} group transition-all duration-200 ${isEditing ? 'ring-1 ring-orange-800/50' : ''}`}>
                    {isEditing && canEdit ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            className="flex-1 bg-[#111] border border-[#333] px-2 py-1 text-[10px] uppercase text-white focus:outline-none focus:border-orange-800"
                            value={phase.name}
                            onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, name: e.target.value } : p))}
                            placeholder="Название"
                          />
                          <input
                            className="w-16 bg-[#111] border border-[#333] px-2 py-1 text-[10px] uppercase text-white focus:outline-none focus:border-orange-800"
                            value={phase.dayRange}
                            onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, dayRange: e.target.value } : p))}
                            placeholder="D1-2"
                          />
                        </div>
                        <textarea
                          className="w-full bg-[#111] border border-[#333] px-2 py-1 text-[11px] text-[#A3A3A3] focus:outline-none focus:border-orange-800 resize-none leading-relaxed"
                          rows={2}
                          value={phase.description}
                          onChange={e => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, description: e.target.value } : p))}
                          placeholder="Описание симптомов..."
                        />
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1">
                            {(['blue', 'yellow', 'red', 'green', 'purple', 'orange', 'cyan'] as const).map(clr => (
                              <button
                                key={clr}
                                onClick={() => setSymptomPhases(prev => prev.map(p => p.id === phase.id ? { ...p, color: clr } : p))}
                                className={`w-4 h-4 rounded-full border-2 transition-all ${
                                  phase.color === clr ? 'border-white scale-125' : 'border-[#333] hover:border-[#555]'
                                }`}
                                style={{ backgroundColor: { blue: '#1e3a5f', yellow: '#5f4a1e', red: '#5f1e1e', green: '#1e5f3a', purple: '#3a1e5f', orange: '#5f3a1e', cyan: '#1e4a5f' }[clr] }}
                              />
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setSymptomPhases(prev => prev.filter(p => p.id !== phase.id))}
                              className="p-1 text-red-900 hover:text-red-500 transition-colors"
                              title="Удалить"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingPhaseId(null)}
                              className="p-1 text-green-900 hover:text-green-500 transition-colors"
                              title="Готово"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`${canEdit ? 'cursor-pointer' : ''}`}
                        onClick={() => canEdit && setEditingPhaseId(phase.id)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-1 h-3 ${c.bar}`}></div>
                          <span className={`text-[10px] uppercase ${c.text} flex-1`}>{phase.name} ({phase.dayRange})</span>
                          {canEdit && (
                            <Pencil className="w-3 h-3 text-[#333] group-hover:text-[#666] transition-colors" />
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed">{phase.description}</p>
                      </div>
                    )}
                  </div>
                );
              })}
              {symptomPhases.length === 0 && (
                <p className="text-[10px] text-[#555] italic">Нет фаз. Нажмите + чтобы добавить.</p>
              )}
            </div>
            </div>
          </div>

          <div className="p-4 bg-[#111] border-t border-[#333] shrink-0">
             <div className="flex flex-col gap-2">
               <label className="text-[10px] uppercase text-[#555]">Period Step</label>
               <select 
                 className="w-full bg-[#0A0A0A] border border-[#222] p-2 text-xs text-[#A3A3A3] focus:outline-none focus:border-red-900 transition-colors disabled:opacity-50"
                 value={stepAmount}
                 onChange={e => setStepAmount(e.target.value)}
                 disabled={isSimulating}
               >
                 <option value="1 день">1 день</option>
                 <option value="3 дня">3 дня</option>
                 <option value="1 неделя">1 неделя</option>
                 <option value="1 месяц">1 месяц</option>
                 <option value="1 год">1 год</option>
               </select>
               <button
                 onClick={startSimulationStep}
                 disabled={isSimulating}
                 className="w-full mt-2 py-3 bg-red-950 border border-red-600 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-900 transition-colors disabled:opacity-50"
               >
                 {isSimulating ? "Симуляция..." : (parsedEvents.length > 0 ? "Advance Time" : "Initiate Leak")}
               </button>
             </div>
          </div>
        </aside>

        {/* Center: Content (Map + Images) */}
        {(mainView === 'split' || mainView === 'map') && (
          <div className="flex-1 relative bg-[#030303] flex items-center justify-center overflow-hidden order-1 md:order-2 h-1/2 md:h-auto z-0 flex-col">
            <div className="absolute inset-0 opacity-10 pointer-events-none z-10" style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
            
            <div className={`w-full ${imageMode === 'off' ? 'h-full' : 'h-1/2'} relative bg-[#0a0a0a] border-b border-[#333]`}>
               <MapView location={location} setLocation={setLocation} mapData={accumulatedMapData} showOverlay={showMapOverlay} />
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
               {/* Overlay Stats hidden for clarity, map runs independently */}
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
                 <ReactMarkdown>{timeline}</ReactMarkdown>
               </div>
            )}

            {parsedEvents.length > 0 && selectedDayIndex >= 0 && parsedEvents[selectedDayIndex] && (
              <div className="flex gap-3 text-[11px] leading-relaxed transition-opacity duration-300 opacity-100">
                 <span className="whitespace-nowrap font-bold mt-[2px] w-12 shrink-0 text-orange-500">T + {parsedEvents[selectedDayIndex].day}d</span>
                 <div className="flex flex-col w-full">
                   <span className="text-[9px] uppercase text-[#777] mb-1 tracking-wider">{parsedEvents[selectedDayIndex].dateStr}</span>
                   <div className="markdown-body whitespace-pre-wrap prose prose-invert prose-p:my-1 prose-sm max-w-none text-[11px] leading-relaxed text-[#E0E0E0]">
                     <ReactMarkdown>{parsedEvents[selectedDayIndex].text}</ReactMarkdown>
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

      <footer className="h-8 border-t border-[#333] hidden md:flex items-center justify-between px-4 bg-[#0A0A0A] text-[9px] uppercase tracking-tighter shrink-0">
        <div className="flex gap-6">
          <span>User: {currentUsername.toUpperCase()}</span>
          <span>Security: LEVEL 5</span>
          <span className="text-green-800">Link: SECURE_128-BIT</span>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1 text-[#555] hover:text-red-500 transition-colors cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            <span>Выход</span>
          </button>
        </div>
        <div className="flex gap-4">
          <span className="text-red-900 font-bold">SIMULATION IS FOR MILITARY PURPOSES ONLY</span>
        </div>
      </footer>

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
    </div>
  );
}
