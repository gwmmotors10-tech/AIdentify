
import { GoogleGenAI, Type } from "@google/genai";
import { PartRecord, RecognitionResult } from "../types";

/**
 * Retorna uma nova instância do cliente GenAI. 
 * É importante instanciar no momento do uso para garantir o acesso à chave API correta (injetada ou selecionada).
 */
export const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING: Por favor, selecione uma chave API no menu de configuração.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Converte uma URL de imagem para Base64 de forma resiliente.
 */
async function imageUrlToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const proxyUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(proxyUrl, { mode: 'cors' });
    
    if (!response.ok) return null;
    
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error(`Erro ao processar imagem para IA: ${url}`, e);
    return null;
  }
}

/**
 * Análise de similaridade multimodal
 */
export const analyzeSimilarity = async (
  targetImageBase64: string,
  history: PartRecord[]
): Promise<RecognitionResult> => {
  const ai = getAIClient();
  const targetData = targetImageBase64.includes(',') ? targetImageBase64.split(',')[1] : targetImageBase64;

  const partsWithImages = history.filter(p => p.imageUrls && p.imageUrls.length > 0);
  if (partsWithImages.length === 0) {
    return { matches: [], detectedFeatures: "Nenhuma imagem de referência disponível no banco." };
  }

  const referenceParts = partsWithImages.slice(0, 8);
  const referenceImagesParts = await Promise.all(
    referenceParts.map(async (part) => {
      const base64 = await imageUrlToBase64(part.imageUrls[0]);
      if (!base64) return null;
      return [
        { text: `[ID: ${part.id}] ${part.partName} (${part.partNumber})` },
        { inlineData: { mimeType: "image/jpeg", data: base64 } }
      ];
    })
  );

  const validRefs = referenceImagesParts.filter(Boolean).flat() as any[];

  const systemInstruction = `
    Você é um especialista em visão industrial. Compare a imagem ALVO com as imagens de REFERÊNCIA.
    Busque por similaridade de forma, furos, relevos e proporções.
    
    Retorne o JSON:
    {
      "matches": [{"id": "string", "score": number, "reason": "motivo em português"}],
      "detectedFeatures": "características técnicas detectadas em português"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: "ALVO:" },
          { inlineData: { mimeType: "image/jpeg", data: targetData } },
          { text: "REFERÊNCIAS:" },
          ...validRefs
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

  return JSON.parse(response.text || '{}') as RecognitionResult;
};

// --- Helpers ---
export function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}
