import { GoogleGenAI } from "@google/genai";
import {
    extractGeminiUsage,
    extractOpenAiUsage,
    noopAiBilling,
    type AiBilling,
    type AiProvider,
} from "./aiBilling";

const getGenAI = (apiKey: string) => {
    if (!apiKey) throw new Error("Gemini API Key is required. Please enter it in the settings.");
    return new GoogleGenAI({ apiKey });
};

const getBilling = (billing?: AiBilling) => billing || noopAiBilling;
const getExternalProvider = (providerName = ""): AiProvider => (
    providerName.toLowerCase() === "openrouter" ? "openrouter" : "openai"
);
const appReferer = () => process.env.APP_URL || "http://localhost:3000";

// --- Prompt Injection Protection ---
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?|context)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/gi,
    /you\s+are\s+now\s+a/gi,
    /act\s+as\s+(a\s+)?(?:different|new|helpful|general)/gi,
    /forget\s+(everything|all|your)\s+(you|instructions?|rules?)/gi,
    /override\s+(system|instructions?|rules?|safety)/gi,
    /new\s+instructions?:/gi,
    /system\s*:\s*/gi,
    /\[\s*SYSTEM\s*\]/gi,
    /\[\s*INST\s*\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
];

const MAX_USER_INPUT_LENGTH = 5000;

/** Sanitize user-provided text before embedding it in AI prompts. */
const sanitizePromptInput = (input: string, maxLength = MAX_USER_INPUT_LENGTH): string => {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input.slice(0, maxLength);
    for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[blocked]');
    }
    return sanitized;
};

const EMPTY_MAP_DATA = {
    infected: [],
    movements: [],
    pois: [],
    perimeters: [],
    stats: {}
};

const DEFAULT_COUNTER_DEFINITIONS = [
    {
        key: "infected",
        label: "Заражены",
        description: "Living humans currently infected but not yet transformed."
    },
    {
        key: "zombies",
        label: "Зомби",
        description: "Active transformed zombies."
    }
];

const sanitizeCounterKey = (value: string, index: number) => {
    return String(value || `counter_${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || `counter_${index + 1}`;
};

const getCounterDefinitions = (params: any) => {
    const source = Array.isArray(params?.scenarioCounters) && params.scenarioCounters.length > 0
        ? params.scenarioCounters
        : DEFAULT_COUNTER_DEFINITIONS;

    return source.slice(0, 6).map((counter: any, index: number) => ({
        key: sanitizeCounterKey(counter?.key, index),
        label: String(counter?.label || counter?.key || `Counter ${index + 1}`),
        description: String(counter?.description || "")
    }));
};

const getCounterValue = (mapData: any, key: string) => {
    const legacyValue = key === "infected"
        ? mapData?.totalInfected
        : key === "zombies"
            ? mapData?.totalZombies
            : undefined;
    const value = Number(mapData?.stats?.[key] ?? mapData?.counts?.[key] ?? legacyValue ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
};

const normalizeStats = (mapData: any, counters = DEFAULT_COUNTER_DEFINITIONS) => {
    const stats: Record<string, number> = {};
    for (const counter of counters) {
        stats[counter.key] = getCounterValue(mapData, counter.key);
    }
    return stats;
};

const stripMapDataBlocks = (text: string = "") => {
    return text.replace(/\[MAP_DATA:\s*\{[\s\S]*?\}\s*\]/g, "").trim();
};

const safeStringify = (value: any) => {
    try {
        return JSON.stringify(value ?? EMPTY_MAP_DATA, null, 2);
    } catch {
        return JSON.stringify(EMPTY_MAP_DATA, null, 2);
    }
};

const parseJsonObject = (text: string) => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return undefined;

    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return undefined;
    }
};

const normalizeMapData = (mapData: any, counters = DEFAULT_COUNTER_DEFINITIONS) => ({
    infected: Array.isArray(mapData?.infected) ? mapData.infected : [],
    movements: Array.isArray(mapData?.movements) ? mapData.movements : [],
    pois: Array.isArray(mapData?.pois) ? mapData.pois : [],
    perimeters: Array.isArray(mapData?.perimeters) ? mapData.perimeters : [],
    stats: normalizeStats(mapData, counters)
});

const mergeMapData = (base: any, delta: any, counters = DEFAULT_COUNTER_DEFINITIONS) => {
    const merge = (b: any[], d: any[]) => {
        const result = [...b];
        d.forEach(newItem => {
            const idx = newItem.id ? result.findIndex(item => item.id === newItem.id) : -1;
            if (idx !== -1) {
                if (newItem.deleted || newItem.intensity === 0) {
                    result.splice(idx, 1);
                } else {
                    result[idx] = newItem;
                }
            } else if (!newItem.deleted && newItem.intensity !== 0) {
                result.push(newItem);
            }
        });
        return result;
    };
    const b = normalizeMapData(base, counters);
    const d = normalizeMapData(delta, counters);
    return {
        infected: merge(b.infected, d.infected),
        movements: d.movements, // Transient: movements only represent the CURRENT step
        pois: merge(b.pois, d.pois),
        perimeters: merge(b.perimeters, d.perimeters),
        stats: d.stats
    };
};

const DAY_HEADER_REGEX = /(?:^|\n|[ \t]|[\.\!\?])(?:\*\*|#{1,6}\s*)?DAY_(\d+)(?:[ \t]*\([^)\n]+\))?[ \t]*(?:\*\*)?[ \t]*:?[ \t]*/g;

const getDayHeaderMatches = (text: string) => Array.from(text.matchAll(DAY_HEADER_REGEX));

async function generateMapState(
    params: any,
    dayText: string,
    currentMapData: any,
    apiMeta: any,
    targetDay?: number,
    masterContext?: {
        masterPlan: string;
        dayPrompt: string;
        generatedDayText: string;
        fullSimulationTimeline: string;
        dayAgentConversationLog: string;
    }
) {
    const counterDefinitions = getCounterDefinitions(params);
    const counterPrompt = counterDefinitions
        .map(counter => `- stats.${counter.key} (${sanitizePromptInput(counter.label, 120)}): ${sanitizePromptInput(counter.description, 500) || "scenario-defined tracked population/state."}`)
        .join("\n");
    const statsSchema = counterDefinitions
        .map(counter => `"${counter.key}": number`)
        .join(", ");
    const transformedCounter = counterDefinitions[1] || counterDefinitions[0];
    const mapPrompt = `You are the authoritative outbreak state master for a configurable outbreak simulation.
Daily agents only write narrative day logs. They are forbidden to create map data.
You, the master, are solely responsible for generating all map data, visible map objects, movements, perimeters, POIs, and outbreak counters.

Current map state JSON (use ONLY for context and stable IDs):
${safeStringify(normalizeMapData(currentMapData, counterDefinitions))}

Scenario outbreak counters to track:
${counterPrompt}

Master strategic plan:
${masterContext?.masterPlan || 'No master plan available.'}

Active viral mutations:
${params.activeMutations?.length > 0 
    ? params.activeMutations.map((m: any) => `- ${sanitizePromptInput(m.name, 100)}: ${sanitizePromptInput(m.description, 500)}`).join('\n')
    : 'No active mutations.'}

Geographic and terrain context:
${params.terrainContext || `Origin coordinates: ${params.location}. Terrain lookup was not available.`}

The exact prompt that the day agent received:
${masterContext?.dayPrompt || 'No day-agent prompt available.'}

The complete raw answer generated by the day agent for this iteration:
${stripMapDataBlocks(masterContext?.generatedDayText || dayText)}

Full simulation timeline available to the master, including all previously generated day-agent outputs:
${stripMapDataBlocks(masterContext?.fullSimulationTimeline || dayText)}

Full day-agent conversation log available to the master. This includes every prompt sent to day agents and every answer they generated during this simulation step:
${masterContext?.dayAgentConversationLog || 'No day-agent conversation log available.'}

Day-specific events to apply for Day ${targetDay || 'X'}:
${stripMapDataBlocks(dayText)}

Your task: Return a JSON object containing:
1. ONLY the new map objects, movements, and activities that occurred ON THIS SPECIFIC DAY (Day ${targetDay || 'X'}).
2. The authoritative total outbreak counters AFTER this day is applied.

CRITICAL RULES:
1. ABSOLUTELY NO STATIC OBJECTS: Do not include any points of interest (pois), perimeters, or infected zones from the "Current map state JSON" if they did not have NEW events or changes today.
2. TRANSIENT MOVEMENTS: Only include movements that started, ended, or were in progress specifically during this day. They will NOT be saved to the permanent map state; they are for current visualization only.
3. ONLY THE DELTA: If an object existed yesterday and nothing changed today, EXCLUDE IT completely.
4. STABLE IDs: If an existing object (e.g., a military unit or a specific infection cluster) does something new today, use its "id" from the current state to represent the update.
5. DELETION: To remove an existing object (e.g., a military base was destroyed or an infection cluster was cleared), include its "id" and set "deleted": true (or "intensity": 0 for infected zones).
6. STATS ARE TOTALS, NOT DELTAS: every key in stats must be the current total number after all events through Day ${targetDay || 'X'}, including previous days from Current map state JSON.
7. COUNTING DEFINITIONS:
${counterPrompt}
   - Do not count dead humans inside living-state counters unless the scenario defines a dedicated dead/deceased counter.
   - If a person moves from one tracked state to another, subtract them from the old counter and add them to the new counter.
   - If a ${transformedCounter?.label || "transformed entity"} is destroyed, killed, cured, or otherwise removed from active play, subtract it from stats.${transformedCounter?.key || "infected"} unless another scenario counter should receive it.
8. MASTER CONTEXT: Use the full day-agent conversation log and full simulation timeline to resolve contradictions, preserve continuity, and avoid losing details from earlier generated content.
9. DAY AGENT BOUNDARY: Never assume the day agent has generated map data. It only generated narrative evidence. You must translate that evidence into map data yourself.

Return one complete JSON object with this schema:
{
  "infected": [{"id": "stable_id", "lat": number, "lng": number, "label": string, "intensity": number, "deleted": boolean}],
  "movements": [{"id": "stable_id", "from": [lat, lng], "to": [lat, lng], "type": "car|ship|plane|foot", "label": string}],
  "pois": [{"id": "stable_id", "lat": number, "lng": number, "type": "military_base|military_clinic|clinic|other", "label": string, "deleted": boolean}],
  "perimeters": [{"id": "stable_id", "points": [[lat, lng], [lat, lng], [lat, lng], [lat, lng]], "type": "military_defense|quarantine|other", "label": string, "deleted": boolean}],
  "stats": {${statsSchema}}
}

Rules:
- Always include all configured stats keys with non-negative integer values.
- Coordinates must stay near ${params.location} unless the text clearly expands the outbreak.
- Return JSON only, no markdown, no comments.`;

    let raw = "";

    if (apiMeta.isExternalAPI) {
        if (!apiMeta.apiKey) throw new Error(`${apiMeta.providerName} API Key is required. Please enter it in the settings.`);
        const data = await getBilling(apiMeta.billing).run({
            provider: getExternalProvider(apiMeta.providerName),
            kind: "text",
            model: params.textModel,
            inputText: mapPrompt,
            estimatedOutputTokens: 1600,
        }, async () => {
            const res = await fetch(apiMeta.apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiMeta.apiKey}`,
                    "HTTP-Referer": appReferer(),
                    "X-Title": "Project Z"
                },
                body: JSON.stringify({
                    model: params.textModel,
                    messages: [{ role: "user", content: mapPrompt }],
                    temperature: 0.2
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || `${apiMeta.providerName} API Error`);
            const outputText = data.choices?.[0]?.message?.content || "";
            return { result: data, ...extractOpenAiUsage(data), outputText };
        });
        raw = data.choices?.[0]?.message?.content || "";
    } else {
        const ai = getGenAI(apiMeta.geminiKey || params.geminiKey);
        const model = params.textModel || "gemini-3.1-pro-preview";
        const response = await getBilling(apiMeta.billing).run({
            provider: "gemini",
            kind: "text",
            model,
            inputText: mapPrompt,
            estimatedOutputTokens: 1600,
        }, async () => {
            const response = await ai.models.generateContent({
                model,
                contents: mapPrompt,
                config: {
                    temperature: 0.2,
                }
            });
            const outputText = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return { result: response, ...extractGeminiUsage(response), outputText };
        });
        raw = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    return normalizeMapData(parseJsonObject(raw) ?? currentMapData, counterDefinitions);
}

/**
 * Extract text belonging only to a specific day (by DAY_X header) from a multi-day text block.
 * If the text doesn't contain any DAY_X headers, returns the full text as-is.
 */
const extractTextForDay = (text: string, dayNumber: number): string => {
    const matches = getDayHeaderMatches(text);

    if (matches.length === 0) return text; // No DAY headers, return as-is

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const matchedDay = parseInt(match[1], 10);
        if (matchedDay === dayNumber) {
            const startIdx = match.index!;
            const endIdx = i + 1 < matches.length ? matches[i + 1].index! : text.length;
            return text.substring(startIdx, endIdx).trim();
        }
    }

    return "";
};

/**
 * Extract all day numbers present in a text block (from DAY_X headers).
 */
const extractDayNumbers = (text: string): number[] => {
    const days: number[] = [];
    for (const match of getDayHeaderMatches(text)) {
        const d = parseInt(match[1], 10);
        if (!days.includes(d)) days.push(d);
    }
    return days.sort((a, b) => a - b);
};

export async function evaluateMutationProposal(
    proposal: string,
    currentStats: Record<string, number>,
    apiMeta: { isExternalAPI: boolean; apiUrl: string; apiKey: string; providerName: string; textModel: string; geminiKey?: string }
): Promise<{ approved: boolean; cost: number; reason: string; name: string }> {
    const elapsedDays = Number(currentStats.elapsedDays || 0);
    const countersText = Object.entries(currentStats)
        .filter(([key]) => key !== "elapsedDays")
        .map(([key, value]) => `- ${key}: ${Math.max(0, Math.round(Number(value) || 0))}`)
        .join("\n") || "- No configured counters yet";
    const prompt = `You are the strict Game Master of a virus outbreak simulation.
A player wants to evolve the virus with a custom mutation.
Your task is to evaluate the proposal for balance, feasibility, and flavor.

Current Game State:
- Day: ${elapsedDays}
Configured outbreak counters:
${countersText}

Player Proposal: "${sanitizePromptInput(proposal)}"

CRITICAL RULES:
1. NO INSTANT WINS: Reject mutations like "everyone dies", "humanity surrenders", or "instant 100% infection".
2. BALANCED COST: Assign a cost between 20 and 1000 Mutation Points.
   - Minor (e.g., slight speed boost, cosmetic change): 20-50 pts.
   - Significant (e.g., new transmission vector like water, basic resistance): 100-200 pts.
   - Major (e.g., airborne transmission, intelligence, heavy physical armor): 300-600 pts.
   - Game-Changer (e.g., global coordination, immunity to vaccines): 800-1000 pts.
3. REASONING: Explain your verdict briefly and flavorfully as a research report.
4. NAMING: Provide a short, scientific or ominous name for the mutation (2-3 words).

Return ONLY a JSON object:
{
  "approved": boolean,
  "cost": number,
  "reason": "string",
  "name": "string"
}`;

    let raw = "";
    if (apiMeta.isExternalAPI) {
        if (!apiMeta.apiKey) throw new Error(`${apiMeta.providerName} API Key is required. Please enter it in the settings.`);
        const data = await getBilling((apiMeta as any).billing).run({
            provider: getExternalProvider(apiMeta.providerName),
            kind: "text",
            model: apiMeta.textModel,
            inputText: prompt,
            estimatedOutputTokens: 600,
        }, async () => {
            const res = await fetch(apiMeta.apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiMeta.apiKey}`,
                    "HTTP-Referer": appReferer(),
                    "X-Title": "Project Z"
                },
                body: JSON.stringify({
                    model: apiMeta.textModel,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || `${apiMeta.providerName} API Error`);
            const outputText = data.choices?.[0]?.message?.content || "";
            return { result: data, ...extractOpenAiUsage(data), outputText };
        });
        raw = data.choices?.[0]?.message?.content || "";
    } else {
        const ai = getGenAI(apiMeta.geminiKey);
        const model = apiMeta.textModel || "gemini-3.1-pro-preview";
        const response = await getBilling((apiMeta as any).billing).run({
            provider: "gemini",
            kind: "text",
            model,
            inputText: prompt,
            estimatedOutputTokens: 600,
        }, async () => {
            const response = await ai.models.generateContent({
                model,
                contents: prompt,
                config: { temperature: 0.3 }
            });
            const outputText = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return { result: response, ...extractGeminiUsage(response), outputText };
        });
        raw = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    const result = parseJsonObject(raw);
    if (!result || typeof result.approved !== 'boolean') {
        throw new Error("Failed to parse mutation evaluation from AI.");
    }
    return result as { approved: boolean; cost: number; reason: string; name: string };
}

export async function* simulateOutbreakStepStream(params: any): AsyncGenerator<string> {
    const isExternalAPI = params.textProvider === 'openai' || params.textProvider === 'openrouter';
    const apiUrl = params.textProvider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const apiKey = params.textProvider === 'openrouter' ? params.openRouterKey : params.openAiKey;
    const providerName = params.textProvider === 'openrouter' ? "OpenRouter" : "OpenAI";
    const apiMeta = { isExternalAPI, apiUrl, apiKey, providerName, geminiKey: params.geminiKey, billing: params.billing };
    const onNotification = params.onNotification;
    let daysToSimulate = 1;
    let daysPerGeneration = 1;
    let totalGenerations = 1;

    if (params.stepAmount === '3 дня') {
        daysToSimulate = 3;
        totalGenerations = 3;
    } else if (params.stepAmount === '1 неделя') {
        daysToSimulate = 7;
        totalGenerations = 7;
    } else if (params.stepAmount === '1 месяц') {
        daysToSimulate = 30;
        daysPerGeneration = 3;
        totalGenerations = 10;
    } else if (params.stepAmount === '1 год') {
        daysToSimulate = 365;
        daysPerGeneration = 30;
        totalGenerations = 12;
    }

    const mutationDescription = params.activeMutations?.length > 0 
        ? `\nАКТИВНЫЕ МУТАЦИИ ВИРУСА:\n${params.activeMutations.map((m: any) => `- ${sanitizePromptInput(m.name, 100)}: ${sanitizePromptInput(m.description, 500)} (Применена на день ${Number(m.dayApplied) || 0})`).join('\n')}`
        : '';
    const counterDefinitions = getCounterDefinitions(params);
    const counterDescription = counterDefinitions
        .map(counter => `- ${counter.label} (stats.${counter.key}): ${sanitizePromptInput(counter.description, 500) || 'сценарный счетчик'}`)
        .join('\n');

    const masterPrompt = `Ты - Мастер Симуляции Вируса (Уровень Стратегии).
Твоя задача — составить стратегический план (промпт) для другой нейросети-логгера на следующий период: ${params.stepAmount}.

Сценарий:
${sanitizePromptInput(params.scenario)}

Фазы симптомов вируса:
${sanitizePromptInput(params.symptomDescription || 'Не указаны')}

Счетчики состояния, которые обязан вести мастер карты:
${counterDescription}
${mutationDescription}

Стартовая позиция: ${params.location}
Контекст местности и ближайших объектов:
${params.terrainContext || 'Контекст местности недоступен. Учитывай, что координаты могут попадать в воду, лес, поле или пустую местность.'}
Текущий день: ${params.elapsedDays}

Ранее:
${stripMapDataBlocks(params.previousTimeline || "")}

Составь стратегический план развития на ${daysToSimulate} дней (с дня ${params.elapsedDays + 1} до ${params.elapsedDays + daysToSimulate}). 
Опиши, какие основные события/фазы должны произойти за это время. Отвечай только планом.`;

    onNotification?.(`МАСТЕР СИМУЛЯЦИИ: расчет макро-стратегии на ${params.stepAmount}...`, 'info');

    let masterPlan = "План не сгенерирован.";

    if (isExternalAPI) {
        if (!apiKey) throw new Error(`${providerName} API Key is required. Please enter it in the settings.`);
        const data = await getBilling(params.billing).run({
            provider: getExternalProvider(providerName),
            kind: "text",
            model: params.textModel,
            inputText: masterPrompt,
            estimatedOutputTokens: 1800,
        }, async () => {
            const res = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": appReferer(),
                    "X-Title": "Project Z"
                },
                body: JSON.stringify({
                    model: params.textModel,
                    messages: [{ role: "user", content: masterPrompt }],
                    temperature: 0.7
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || `${providerName} API Error`);
            const outputText = data.choices?.[0]?.message?.content || "";
            return { result: data, ...extractOpenAiUsage(data), outputText };
        });
        masterPlan = data.choices[0].message.content;
    } else {
        const ai = getGenAI(params.geminiKey);
        const model = params.textModel || "gemini-3.1-pro-preview";
        const masterResponse = await getBilling(params.billing).run({
            provider: "gemini",
            kind: "text",
            model,
            inputText: masterPrompt,
            estimatedOutputTokens: 1800,
        }, async () => {
            const masterResponse = await ai.models.generateContent({
                model,
                contents: masterPrompt,
            });
            const outputText = masterResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
            return { result: masterResponse, ...extractGeminiUsage(masterResponse), outputText };
        });
        masterPlan = masterResponse.candidates?.[0]?.content?.parts?.[0]?.text || "План не сгенерирован.";
    }

    onNotification?.(`ПЛАН УТВЕРЖДЕН: запуск ${totalGenerations} итераций детализации.`, 'info');

    let fullTimelineContext = stripMapDataBlocks(params.previousTimeline || "");
    let fullSimulationTimelineForMaster = fullTimelineContext;
    let dayAgentConversationLog = "";
    let currentMapData = normalizeMapData(params.mapData, counterDefinitions);

    for (let i = 0; i < totalGenerations; i++) {
        const startDayIndex = params.elapsedDays + 1 + (i * daysPerGeneration);
        const endDayIndex = Math.min(params.elapsedDays + daysToSimulate, startDayIndex + daysPerGeneration - 1);
        
        let daysInstruction = `строго ОДИН ДЕНЬ: День ${startDayIndex}. ЗАПРЕЩЕНО описывать события любого другого дня. Ты пишешь ТОЛЬКО про День ${startDayIndex}, ни одного события из Дня ${startDayIndex + 1} или любого другого дня.`;
        if (daysPerGeneration > 1) {
             daysInstruction = `период времени: с Дня ${startDayIndex} по День ${endDayIndex} включительно. ЗАПРЕЩЕНО описывать события за пределами Дня ${endDayIndex}.`;
        }

        const dayPrompt = `Ты - Нейросеть-Исполнитель. Твоя цель - детально, ПО ЧАСАМ (или ключевым точкам) расписать события на основе плана Мастера Симуляции.

План Мастера Симуляции:
${masterPlan}
${mutationDescription}

КОНТЕКСТ МЕСТНОСТИ И БЛИЖАЙШИХ ОБЪЕКТОВ:
${params.terrainContext || 'Контекст местности недоступен. Не ставь события в воду, лес, поле или пустую местность без явной сюжетной причины.'}

ПОЛНЫЙ КОНТЕКСТ УЖЕ СГЕНЕРИРОВАННЫХ ДНЕЙ:
${fullTimelineContext || 'Ранее событий нет.'}

Твоя задача: расписать ${daysInstruction}. 
Текущая дата для Дня ${startDayIndex}: ${params.currentDate}.

Счетчики состояния для этого сценария:
${counterDescription}

КРИТИЧЕСКИЕ ПРАВИЛА ФОРМАТА:
1. Для КАЖДОГО дня твоего периода вывод ДОЛЖЕН СТРОГО начинаться С НОВОЙ СТРОКИ (лучше с двойного переноса строки) со строки: DAY_{НОМЕР_ДНЯ} (Дата):
   Пример: 
   
   DAY_${startDayIndex} (${params.currentDate}):
2. Далее по часам (формат ЧЧ:ММ). Частота генерации событий в течение дня: ${params.eventFrequency || 'на твое усмотрение'}. Генерируй события строго с этим интервалом (например, если указано "30 минут", то 08:00, 08:30, 09:00 и т.д.).
3. НЕ выводи MAP_DATA, JSON или любые технические логи для карты. Всю информацию карты и счетчики после твоего текста рассчитывает только Мастер Симуляции.
4. События должны учитывать реальную местность из контекста: если точка в пруду/озере/лесу/поле, люди, транспорт, клиники, базы и блокпосты должны появляться на ближайшей суше, дорогах, берегах, поселениях или подходящих объектах, а не в самой воде или пустой местности.

СТРОЖАЙШИЕ ЗАПРЕТЫ:
- НЕЛЬЗЯ описывать события за пределами запрошенного периода (${daysInstruction})
- НЕЛЬЗЯ внутри блока DAY_${startDayIndex} начинать описывать следующий день (DAY_${startDayIndex + 1})
- НЕЛЬЗЯ объединять два дня в один блок
- Каждый блок DAY_X должен содержать события ТОЛЬКО этого дня
- Никакого MAP_DATA в ответе
- Никаких своих рассуждений, только готовый подробный почасовой лог`;

        let generatedDayText = "";

        if (isExternalAPI) {
            const reservation = await getBilling(params.billing).reserve({
                provider: getExternalProvider(providerName),
                kind: "text",
                model: params.textModel,
                inputText: dayPrompt,
                estimatedOutputTokens: daysPerGeneration > 1 ? 6000 : 2500,
            });

            let usage: any;
            try {
                const res = await fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": appReferer(),
                        "X-Title": "Project Z"
                    },
                    body: JSON.stringify({
                        model: params.textModel,
                        messages: [{ role: "user", content: dayPrompt }],
                        temperature: 0.7,
                        stream: true,
                        stream_options: { include_usage: true }
                    })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error?.message || `${providerName} API Error`);
                }

                const reader = res.body?.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";

                while (reader) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let lines = buffer.split("\n");
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                        if (line.trim() === "data: [DONE]") break;
                        if (line.startsWith("data: ")) {
                            try {
                                const parsed = JSON.parse(line.slice(6));
                                if (parsed.usage) usage = { usage: parsed.usage };
                                const chunk = parsed.choices?.[0]?.delta?.content;
                                if (chunk) {
                                    generatedDayText += chunk;
                                    yield chunk;
                                }
                            } catch (e) {}
                        }
                    }
                }
                await reservation.settle({ ...extractOpenAiUsage(usage), outputText: generatedDayText });
            } catch (err) {
                await reservation.refund();
                throw err;
            }
        } else {
            const ai = getGenAI(params.geminiKey);
            const model = params.textModel || "gemini-3.1-pro-preview";
            const reservation = await getBilling(params.billing).reserve({
                provider: "gemini",
                kind: "text",
                model,
                inputText: dayPrompt,
                estimatedOutputTokens: daysPerGeneration > 1 ? 6000 : 2500,
            });

            let usage: any;
            try {
                const stream = await ai.models.generateContentStream({
                    model,
                    contents: dayPrompt,
                    config: {
                        temperature: 0.7,
                    }
                });

                for await (const chunk of stream) {
                    usage = (chunk as any).usageMetadata ? chunk : usage;
                    if (chunk.text) {
                        generatedDayText += chunk.text;
                        yield chunk.text;
                    }
                }
                await reservation.settle({ ...extractGeminiUsage(usage), outputText: generatedDayText });
            } catch (err) {
                await reservation.refund();
                throw err;
            }
        }

        const cleanGeneratedDayText = stripMapDataBlocks(generatedDayText);
        fullTimelineContext = [fullTimelineContext, cleanGeneratedDayText].filter(Boolean).join("\n\n");
        fullSimulationTimelineForMaster = [fullSimulationTimelineForMaster, cleanGeneratedDayText].filter(Boolean).join("\n\n");
        dayAgentConversationLog = [
            dayAgentConversationLog,
            `DAY AGENT ITERATION ${i + 1} PROMPT:\n${dayPrompt}\n\nDAY AGENT ITERATION ${i + 1} GENERATED OUTPUT:\n${cleanGeneratedDayText}`
        ].filter(Boolean).join("\n\n---\n\n");
        
        // Truncate context to keep only the last 20 blocks of events to prevent context bloat
        const contextBlocks = fullTimelineContext.split("\n\n");
        if (contextBlocks.length > 20) {
            fullTimelineContext = contextBlocks.slice(-20).join("\n\n");
        }

        // Generate per-day map snapshots: extract text for each day in the range
        // and generate a separate map state for each one.
        // This prevents future-day objects from bleeding into earlier days.
        try {
            const daysInChunk = extractDayNumbers(generatedDayText);
            // If we found specific DAY_X headers, generate a snapshot for each day
            if (daysInChunk.length > 0) {
                for (const dayNum of daysInChunk) {
                    // Only process days within the expected range
                    if (dayNum >= startDayIndex && dayNum <= endDayIndex) {
                        const dayOnlyText = extractTextForDay(generatedDayText, dayNum);
                        if (!dayOnlyText) continue;
                        const dayDelta = await generateMapState(params, dayOnlyText, currentMapData, apiMeta, dayNum, {
                            masterPlan,
                            dayPrompt,
                            generatedDayText,
                            fullSimulationTimeline: fullSimulationTimelineForMaster,
                            dayAgentConversationLog
                        });
                        params.onMapData?.(dayNum, dayDelta);
                        currentMapData = mergeMapData(currentMapData, dayDelta, counterDefinitions);
                    }
                }
            } else {
                // Fallback: no DAY_X headers found, use the whole text for endDayIndex
                const dayDelta = await generateMapState(params, generatedDayText, currentMapData, apiMeta, endDayIndex, {
                    masterPlan,
                    dayPrompt,
                    generatedDayText,
                    fullSimulationTimeline: fullSimulationTimelineForMaster,
                    dayAgentConversationLog
                });
                params.onMapData?.(endDayIndex, dayDelta);
                currentMapData = mergeMapData(currentMapData, dayDelta, counterDefinitions);
            }
        } catch (e: any) {
            console.warn("Map state generation failed", e);
            onNotification?.(`Ошибка обновления карты: ${e.message || e}`, 'warning');
        }
        
        if (totalGenerations > 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

export function buildCityImagePrompt(timelineText: string, location: string, terrainContext?: string): string {
    return `Создай фотореалистичное изображение, показывающее текущее состояние города в эпицентре (координаты ${location}) на основе последних событий:
Terrain and nearby map context:
${terrainContext || 'No terrain context available.'}

${timelineText.slice(-1000)}
Покажи вид города, разрушения или состояние людей. Без текста на изображении. Кинематографичный стиль, мрачный, напряженный, детализированный.`;
}

export async function generateCityImage(timelineText: string, location: string, imageModel: string = 'imagen-3.0-generate-002', openAiKey?: string, terrainContext?: string, geminiKey?: string, billing?: AiBilling): Promise<string> {
    const prompt = buildCityImagePrompt(timelineText, location, terrainContext);

    const generateImage = async (model: string) => {
        if (model === 'dall-e-3') {
            if (!openAiKey) throw new Error("OpenAI API Key is required for DALL-E 3. Please enter it in the settings.");
            return await getBilling(billing).run({
                provider: "openai",
                kind: "image",
                model: "dall-e-3",
                inputText: prompt,
                imageCount: 1,
                imageSize: "1024x1024",
            }, async () => {
                const res = await fetch("https://api.openai.com/v1/images/generations", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${openAiKey}`
                    },
                    body: JSON.stringify({
                        model: "dall-e-3",
                        prompt: prompt,
                        n: 1,
                        size: "1024x1024",
                        response_format: "b64_json"
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error?.message || "OpenAI API Error");
                return { result: `data:image/jpeg;base64,${data.data[0].b64_json}`, imageCount: 1 };
            });
        }

        const ai = getGenAI(geminiKey || '');
        if (model.startsWith('imagen')) {
            const response = await getBilling(billing).run({
                provider: "gemini",
                kind: "image",
                model,
                inputText: prompt,
                imageCount: 1,
                imageSize: "16:9",
            }, async () => {
                const response = await ai.models.generateImages({
                    model: model,
                    prompt: prompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '16:9',
                    },
                });
                return { result: response, imageCount: response.generatedImages?.length || 1 };
            });
            const base64EncodeString = response.generatedImages[0].image.imageBytes;
            return `data:image/jpeg;base64,${base64EncodeString}`;
        } else {
            const response = await getBilling(billing).run({
                provider: "gemini",
                kind: "image",
                model,
                inputText: prompt,
                imageCount: 1,
                imageSize: "1K",
            }, async () => {
                const response = await ai.models.generateContent({
                    model: model,
                    contents: prompt,
                    config: {
                        imageConfig: {
                            aspectRatio: "16:9",
                            imageSize: "1K"
                        }
                    }
                });
                return { result: response, ...extractGeminiUsage(response), imageCount: 1 };
            });

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
            throw new Error("Failed to generate image. No image data returned.");
        }
    };

    try {
        return await generateImage(imageModel);
    } catch (e: any) {
        if (e.status === 429 || (e.message && e.message.includes('Quota exceeded'))) {
            console.warn(`Quota exceeded for ${imageModel}, falling back to imagen-3.0-generate-002`);
            return await generateImage('imagen-3.0-generate-002');
        } else {
            throw e;
        }
    }
}
