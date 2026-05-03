import { getSessionToken } from './auth';

const API_BASE = '/api/ai';

const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const token = getSessionToken();
    const headers = new Headers(options.headers || {});
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        let errStr = res.statusText;
        try {
            const data = await res.json();
            errStr = data.error || errStr;
        } catch(e) {}
        throw new Error(errStr);
    }
    return res;
};

export function buildCityImagePrompt(timelineText: string, location: string, terrainContext?: string): string {
    return `Создай фотореалистичное изображение, показывающее текущее состояние города в эпицентре (координаты ${location}) на основе последних событий:\nTerrain and nearby map context:\n${terrainContext || 'No terrain context available.'}\n\n${timelineText.slice(-1000)}\nПокажи вид города, разрушения или состояние людей. Без текста на изображении. Кинематографичный стиль, мрачный, напряженный, детализированный.`;
}

export async function evaluateMutationProposal(
    proposal: string,
    currentStats: { infected: number; zombies: number; elapsedDays: number },
    apiMeta: any
) {
    const res = await fetchWithAuth(`${API_BASE}/mutation`, {
        method: 'POST',
        body: JSON.stringify({ proposal, currentStats })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.result;
}

export async function* simulateOutbreakStepStream(params: any): AsyncGenerator<string> {
    const token = getSessionToken();
    const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(params) // NOTE: onMapData and onNotification cannot be stringified, handled differently
    });

    if (!res.ok) {
        throw new Error(`Server error: ${res.statusText}`);
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
                    if (parsed.type === 'chunk') {
                        yield parsed.text;
                    } else if (parsed.type === 'mapUpdate') {
                        params.onMapData?.(parsed.dayNum, parsed.dayDelta);
                    } else if (parsed.type === 'notification') {
                        params.onNotification?.(parsed.message, parsed.notifType);
                    } else if (parsed.type === 'error') {
                        throw new Error(parsed.error);
                    }
                } catch (e) {}
            }
        }
    }
}

export async function generateCityImage(timelineText: string, location: string, imageModel: string, openAiKey?: string, terrainContext?: string, geminiKey?: string): Promise<string> {
    const res = await fetchWithAuth(`${API_BASE}/image`, {
        method: 'POST',
        body: JSON.stringify({ timelineText, location, terrainContext })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.image;
}
