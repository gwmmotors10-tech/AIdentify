
import { GoogleGenAI, Type } from "@google/genai";
import { PartRecord, RecognitionResult } from "../types";

export const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
};

/**
 * Converte uma URL de imagem para Base64 de forma resiliente.
 * Se falhar (ex: erro de CORS no Supabase), retorna null.
 */
async function imageUrlToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    // Adicionamos um timestamp para evitar cache agressivo que pode causar erros de CORS em alguns casos
    const proxyUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(proxyUrl, { mode: 'cors' });
    
    if (!response.ok) {
      console.warn(`Falha ao buscar imagem: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = () => {
        console.error("Erro no FileReader");
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error(`Erro de conexão/CORS ao processar imagem: ${url}`, e);
    return null;
  }
}

/**
 * Análise de similaridade multimodal (Imagem vs Imagens do Banco)
 */
export const analyzeSimilarity = async (
  targetImageBase64: string,
  history: PartRecord[]
): Promise<RecognitionResult> => {
  const ai = getAIClient();
  const targetData = targetImageBase64.includes(',') ? targetImageBase64.split(',')[1] : targetImageBase64;

  // Filtrar apenas peças que têm imagens válidas
  const partsWithImages = history.filter(p => p.imageUrls && p.imageUrls.length > 0);
  
  if (partsWithImages.length === 0) {
    return {
      matches: [],
      detectedFeatures: "Nenhuma peça com imagem encontrada no banco de dados para comparação visual."
    };
  }

  // Limitamos a 8 referências para garantir performance e evitar limites de payload
  const referenceParts = partsWithImages.slice(0, 8);

  const referenceImagesParts = await Promise.all(
    referenceParts.map(async (part) => {
      const base64 = await imageUrlToBase64(part.imageUrls[0]);
      if (!base64) return null;
      return [
        { text: `[ID: ${part.id}] PEÇA: ${part.partName} (Nº ${part.partNumber})` },
        { inlineData: { mimeType: "image/jpeg", data: base64 } }
      ];
    })
  );

  const validRefs = referenceImagesParts.filter(Boolean).flat() as any[];

  if (validRefs.length === 0) {
    return {
      matches: [],
      detectedFeatures: "Erro ao carregar as imagens de referência do banco de dados. Verifique as configurações de CORS do seu bucket no Supabase."
    };
  }

  const systemInstruction = `
    Você é um Especialista em Visão Computacional Industrial.
    Sua missão é comparar a imagem ALVO (TARGET) com as imagens de REFERÊNCIA fornecidas.
    
    CRITÉRIOS DE ANÁLISE:
    1. Geometria: Verifique formas, furos, bordas e proporções.
    2. Detalhes: Observe texturas, marcações e cores.
    3. Use as imagens de referência para identificar qual peça do banco de dados é a mais provável.

    REGRA DE RESPOSTA:
    Retorne estritamente um JSON no formato:
    {
      "matches": [{"id": "string", "score": number, "reason": "descrição curta em português"}],
      "detectedFeatures": "Breve diagnóstico técnico da peça capturada em português"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Flash é mais rápido e excelente para visão-para-json
      contents: [
        {
          parts: [
            { text: "IMAGEM ALVO PARA RECONHECIMENTO:" },
            { inlineData: { mimeType: "image/jpeg", data: targetData } },
            { text: "--- INÍCIO DO BANCO DE REFERÊNCIAS ---" },
            ...validRefs,
            { text: "--- FIM DO BANCO. ANALISE E COMPARE AGORA. ---" }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  reason: { type: Type.STRING }
                },
                required: ["id", "score", "reason"]
              }
            },
            detectedFeatures: { type: Type.STRING }
          },
          required: ["matches", "detectedFeatures"]
        }
      }
    });

    const resultText = response.text || '{}';
    return JSON.parse(resultText) as RecognitionResult;
  } catch (error: any) {
    console.error("Erro na análise profunda do Gemini:", error);
    return { 
      matches: [], 
      detectedFeatures: `Erro técnico na análise: ${error.message || 'Falha na comunicação com o motor de IA'}.` 
    };
  }
};

// --- Live Audio Helpers (Mantidos sem alterações) ---

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
