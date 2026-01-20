
import { GoogleGenAI, Type } from "@google/genai";
import { PartRecord, RecognitionResult } from "../types";

export const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
};

/**
 * Converte uma URL de imagem para Base64 para que o Gemini possa processar
 */
async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error(`Erro ao processar imagem de referência: ${url}`, e);
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
  const targetData = targetImageBase64.split(',')[1] || targetImageBase64;

  // Filtramos apenas peças que possuem imagens para comparação visual
  // Limitamos a 10 peças para evitar exceder limites de token/latência
  const referenceParts = history
    .filter(p => p.imageUrls && p.imageUrls.length > 0)
    .slice(0, 12);

  const referenceImagesParts = await Promise.all(
    referenceParts.map(async (part) => {
      const base64 = await imageUrlToBase64(part.imageUrls[0]);
      if (!base64) return null;
      return [
        { text: `REFERENCE_PART_ID: ${part.id} | Name: ${part.partName} | No: ${part.partNumber}` },
        { inlineData: { mimeType: "image/jpeg", data: base64 } }
      ];
    })
  );

  const flattenedRefs = referenceImagesParts.filter(Boolean).flat() as any[];

  const systemInstruction = `
    You are a specialized Industrial Vision AI. 
    Your task is to compare the "TARGET_IMAGE" with the provided "REFERENCE_IMAGES".
    
    1. Analyze the TARGET_IMAGE for shape, holes, texture, and color.
    2. Compare it visually against each image in the reference sequence.
    3. Assign a similarity score (0-100) based on visual resemblance.
    4. If no visual match is found, focus on the most similar physical characteristics.
    
    Return a JSON object:
    {
      "matches": [{"id": string, "score": number, "reason": string}],
      "detectedFeatures": string
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          parts: [
            { text: "TARGET_IMAGE:" },
            { inlineData: { mimeType: "image/jpeg", data: targetData } },
            { text: "--- REFERENCE DATABASE START ---" },
            ...flattenedRefs,
            { text: "--- END OF DATABASE. Please analyze similarity now. ---" }
          ]
        }
      ],
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 32768 },
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
  } catch (error) {
    console.error("Similarity Analysis Error:", error);
    return { 
      matches: [], 
      detectedFeatures: "Erro ao processar análise multimodal. Verifique a conexão com o banco de imagens." 
    };
  }
};

// --- Live Audio Helpers (Mantidos para Assistente) ---

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
