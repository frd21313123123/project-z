import { GoogleGenAI } from "@google/genai";

const getGenAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function* simulateOutbreakStepStream(params: any): AsyncGenerator<string> {
    const isExternalAPI = params.textProvider === 'openai' || params.textProvider === 'openrouter';
    const apiUrl = params.textProvider === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const apiKey = params.textProvider === 'openrouter' ? params.openRouterKey : params.openAiKey;
    const providerName = params.textProvider === 'openrouter' ? "OpenRouter" : "OpenAI";
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

    const masterPrompt = `Ты - Мастер Симуляции Вируса (Уровень Стратегии).
Твоя задача — составить стратегический план (промпт) для другой нейросети-логгера на следующий период: ${params.stepAmount}.

Сценарий:
${params.scenario}

Фазы симптомов вируса:
${params.symptomDescription || 'Не указаны'}

Стартовая позиция: ${params.location}
Текущий день: ${params.elapsedDays}

Ранее:
${params.previousTimeline.slice(-1500)}

Составь стратегический план развития на ${daysToSimulate} дней (с дня ${params.elapsedDays + 1} до ${params.elapsedDays + daysToSimulate}). 
Опиши, какие основные события/фазы должны произойти за это время. Отвечай только планом.`;

    yield `\n**[МАСТЕР СИМУЛЯЦИИ]** Выполняется расчет макро-стратегии на ${params.stepAmount}...\n\n`;

    let masterPlan = "План не сгенерирован.";

    if (isExternalAPI) {
        if (!apiKey) throw new Error(`${providerName} API Key is required. Please enter it in the settings.`);
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": window.location.href, // Required for OpenRouter
                "X-Title": "Project Z Simulator"
            },
            body: JSON.stringify({
                model: params.textModel,
                messages: [{ role: "user", content: masterPrompt }],
                temperature: 0.7
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `${providerName} API Error`);
        masterPlan = data.choices[0].message.content;
    } else {
        const ai = getGenAI();
        const masterResponse = await ai.models.generateContent({
            model: params.textModel || "gemini-3.1-pro-preview",
            contents: masterPrompt,
        });
        masterPlan = masterResponse.candidates?.[0]?.content?.parts?.[0]?.text || "План не сгенерирован.";
    }

    yield `**[ПЛАН УТВЕРЖДЕН]** Запуск серии генераций для детализации событий (Итераций: ${totalGenerations})...\n\n`;

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

Твоя задача: расписать ${daysInstruction}

КРИТИЧЕСКИЕ ПРАВИЛА ФОРМАТА:
1. Для КАЖДОГО дня твоего периода вывод ДОЛЖЕН СТРОГО начинаться со строки: DAY_{НОМЕР_ДНЯ} (Дата):
2. Далее по часам (формат ЧЧ:ММ): 08:00 - ... / 11:30 - ...
3. В конце КАЖДОГО дня В ОБЯЗАТЕЛЬНОМ ПОРЯДКЕ выведи технический лог для карты одной строкой:
[MAP_DATA: {"infected": [[lat, lng]], "movements": [{"from": [lat, lng], "to": [lat, lng], "type": "car"}], "pois": [{"lat": lat, "lng": lng, "type": "military_base", "label": "Название"}], "perimeters": [{"points": [[lat, lng], [lat, lng], [lat, lng], [lat, lng]], "type": "military_defense", "label": "Периметр"}]}]
(замени lat/lng на числовые координаты вокруг ${params.location}; 
- movements.type: car, ship, plane, foot.
- pois: важные локации (военные поликлиники, обычные поликлиники, военные базы), type: military_clinic, clinic, military_base.
- perimeters: защитные сети/периметры из сюжета, points - это массив из 4 точек для построения квадрата/зоны на карте)

СТРОЖАЙШИЕ ЗАПРЕТЫ:
- НЕЛЬЗЯ описывать события за пределами запрошенного периода (${daysInstruction})
- НЕЛЬЗЯ внутри блока DAY_${startDayIndex} начинать описывать следующий день (DAY_${startDayIndex + 1})
- НЕЛЬЗЯ объединять два дня в один блок
- Каждый блок DAY_X должен содержать события ТОЛЬКО этого дня
- Никаких комментариев к MAP_DATA
- Никаких своих рассуждений, только готовый подробный почасовой лог`;

        if (isExternalAPI) {
            const res = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": window.location.href,
                    "X-Title": "Project Z Simulator"
                },
                body: JSON.stringify({
                    model: params.textModel,
                    messages: [{ role: "user", content: dayPrompt }],
                    temperature: 0.7,
                    stream: true
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
                            const chunk = parsed.choices[0]?.delta?.content;
                            if (chunk) yield chunk;
                        } catch (e) {}
                    }
                }
            }
        } else {
            const ai = getGenAI();
            const stream = await ai.models.generateContentStream({
                model: params.textModel || "gemini-3.1-pro-preview",
                contents: dayPrompt,
                config: {
                    temperature: 0.7,
                }
            });

            for await (const chunk of stream) {
                if (chunk.text) {
                    yield chunk.text;
                }
            }
        }
        
        yield `\n\n`;
        
        if (totalGenerations > 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

export function buildCityImagePrompt(timelineText: string, location: string): string {
    return `Создай фотореалистичное изображение, показывающее текущее состояние города в эпицентре (координаты ${location}) на основе последних событий:
${timelineText.slice(-1000)}
Покажи вид города, разрушения или состояние людей. Без текста на изображении. Кинематографичный стиль, мрачный, напряженный, детализированный.`;
}

export async function generateCityImage(timelineText: string, location: string, imageModel: string = 'imagen-3.0-generate-002', openAiKey?: string): Promise<string> {
    const prompt = buildCityImagePrompt(timelineText, location);

    const generateImage = async (model: string) => {
        if (model === 'dall-e-3') {
            if (!openAiKey) throw new Error("OpenAI API Key is required for DALL-E 3. Please enter it in the settings.");
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
            return `data:image/jpeg;base64,${data.data[0].b64_json}`;
        }

        const ai = getGenAI();
        if (model.startsWith('imagen')) {
            const response = await ai.models.generateImages({
                model: model,
                prompt: prompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: '16:9',
                },
            });
            const base64EncodeString = response.generatedImages[0].image.imageBytes;
            return `data:image/jpeg;base64,${base64EncodeString}`;
        } else {
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
