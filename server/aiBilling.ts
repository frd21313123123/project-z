export type AiProvider = 'gemini' | 'openai' | 'openrouter';
export type AiRequestKind = 'text' | 'image';

export interface BillableAiRequest {
  provider: AiProvider;
  model: string;
  kind: AiRequestKind;
  inputText?: string;
  estimatedOutputTokens?: number;
  imageCount?: number;
  imageSize?: string;
}

export interface BillableAiActual {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outputText?: string;
  imageCount?: number;
  providerCostUsd?: number;
}

export interface BillableAiOutcome<T> extends BillableAiActual {
  result: T;
}

export interface AiBillingReservation {
  estimatedCredits: number;
  settle(actual: BillableAiActual): Promise<void>;
  refund(): Promise<void>;
}

export interface AiBilling {
  reserve(request: BillableAiRequest): Promise<AiBillingReservation>;
  run<T>(
    request: BillableAiRequest,
    task: () => Promise<BillableAiOutcome<T>>
  ): Promise<T>;
}

const envNumber = (name: string, fallback: number, min = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
};

const CREDIT_USD = envNumber('AI_CREDIT_USD', 0.01, 0.000001);
const MIN_TEXT_CREDITS = envNumber('AI_MIN_TEXT_CREDITS', 0.001);
const MIN_IMAGE_CREDITS = envNumber('AI_MIN_IMAGE_CREDITS', 1);
const RESERVE_MULTIPLIER = envNumber('AI_RESERVE_MULTIPLIER', 1.25, 1);

type TextRate = { inputUsdPer1M: number; outputUsdPer1M: number };

const TEXT_RATES: Record<string, TextRate> = {
  'gpt-4o': { inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
  'gpt-4.1': { inputUsdPer1M: 2, outputUsdPer1M: 8 },
  'gpt-5': { inputUsdPer1M: 3, outputUsdPer1M: 15 },
  'gemini-3.1-pro': { inputUsdPer1M: 2, outputUsdPer1M: 12 },
  'gemini-2.5-pro': { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  'gemini-2.5-flash': { inputUsdPer1M: 0.3, outputUsdPer1M: 2.5 },
  'anthropic/claude': { inputUsdPer1M: 3, outputUsdPer1M: 15 },
};

const DEFAULT_TEXT_RATE: Record<AiProvider, TextRate> = {
  gemini: { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  openai: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
  openrouter: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
};

const IMAGE_PRICES_USD: Record<string, number> = {
  'dall-e-3:1024x1024': 0.08,
  'gpt-image-2:1K': 0.04,
  'imagen-3.0-generate-002:16:9': 0.04,
  'imagen-4.0-generate-preview-06-06:16:9': 0.04,
};

export const noopAiBilling: AiBilling = {
  async reserve(request) {
    const estimatedCredits = estimateAiCostCredits(request);
    return {
      estimatedCredits,
      async settle() {},
      async refund() {},
    };
  },
  async run(_request, task) {
    const outcome = await task();
    return outcome.result;
  },
};

export function estimateTokens(text = '') {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function extractOpenAiUsage(data: any): BillableAiActual {
  return {
    inputTokens: Number(data?.usage?.prompt_tokens ?? data?.usage?.input_tokens) || undefined,
    outputTokens: Number(data?.usage?.completion_tokens ?? data?.usage?.output_tokens) || undefined,
    totalTokens: Number(data?.usage?.total_tokens) || undefined,
    providerCostUsd: Number(data?.usage?.cost) || undefined,
  };
}

export function extractGeminiUsage(response: any): BillableAiActual {
  const usage = response?.usageMetadata;
  return {
    inputTokens: Number(usage?.promptTokenCount) || undefined,
    outputTokens: Number(usage?.candidatesTokenCount) || undefined,
    totalTokens: Number(usage?.totalTokenCount) || undefined,
  };
}

export function estimateAiCostCredits(request: BillableAiRequest) {
  const credits = request.kind === 'image'
    ? estimateImageCredits(request)
    : estimateTextCredits(request, {
        inputTokens: estimateTokens(request.inputText),
        outputTokens: request.estimatedOutputTokens || Math.max(1024, Math.ceil(estimateTokens(request.inputText) * 0.5)),
      }) * RESERVE_MULTIPLIER;

  return roundCredits(credits);
}

export function actualAiCostCredits(request: BillableAiRequest, actual: BillableAiActual) {
  if (actual.providerCostUsd && actual.providerCostUsd > 0) {
    return roundCredits(Math.max(actual.providerCostUsd / CREDIT_USD, MIN_TEXT_CREDITS));
  }

  const credits = request.kind === 'image'
    ? estimateImageCredits({ ...request, imageCount: actual.imageCount || request.imageCount || 1 })
    : estimateTextCredits(request, {
        inputTokens: actual.inputTokens || estimateTokens(request.inputText),
        outputTokens: actual.outputTokens || estimateTokens(actual.outputText),
        totalTokens: actual.totalTokens,
      });

  return roundCredits(credits);
}

function estimateTextCredits(
  request: BillableAiRequest,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
) {
  const rate = getTextRate(request.provider, request.model);
  const inputTokens = Math.max(0, usage.inputTokens || Math.ceil((usage.totalTokens || 0) * 0.6));
  const outputTokens = Math.max(0, usage.outputTokens || Math.ceil((usage.totalTokens || 0) * 0.4));
  const usd = (inputTokens / 1_000_000) * rate.inputUsdPer1M
    + (outputTokens / 1_000_000) * rate.outputUsdPer1M;
  return Math.max(usd / CREDIT_USD, MIN_TEXT_CREDITS);
}

function estimateImageCredits(request: BillableAiRequest) {
  const key = `${request.model}:${request.imageSize || '16:9'}`;
  const fallbackKey = request.model === 'dall-e-3' ? 'dall-e-3:1024x1024' : 'imagen-3.0-generate-002:16:9';
  const imageUsd = IMAGE_PRICES_USD[key] || IMAGE_PRICES_USD[fallbackKey] || 0.04;
  return Math.max((imageUsd / CREDIT_USD) * (request.imageCount || 1), MIN_IMAGE_CREDITS);
}

function getTextRate(provider: AiProvider, model = '') {
  const normalized = model.toLowerCase();
  const matchedKey = Object.keys(TEXT_RATES).find(key => normalized.startsWith(key));
  return matchedKey ? TEXT_RATES[matchedKey] : DEFAULT_TEXT_RATE[provider];
}

function roundCredits(value: number) {
  return Math.max(0, Math.ceil(value * 1_000_000) / 1_000_000);
}
