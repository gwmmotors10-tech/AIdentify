
import { GoogleGenAI, Type } from "@google/genai";
import { PartRecord, RecognitionResult } from "../types";

export const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
};

/**
 * Upgraded analysis using Gemini 3 Pro with Thinking Mode
 */
export const analyzeSimilarity = async (
  targetImageBase64: string,
  history: PartRecord[]
): Promise<RecognitionResult> => {
  const ai = getAIClient();
  const base64Data = targetImageBase64.split(',')[1] || targetImageBase64;

  const systemInstruction = `
    You are an Industrial Part Recognition Expert with deep thinking capabilities. 
    Analyze the provided image and compare it to the reference database.
    
    CRITICAL: You MUST use your thinking budget to analyze micro-textures, geometric proportions, and specific automotive finish types.
    
    Return a JSON object:
    {
      "matches": [{"id": string, "score": number, "reason": string}],
      "detectedFeatures": string
    }
    
    Database:
    ${history.map(p => `ID: ${p.id} | Name: ${p.partName} | No: ${p.partNumber} | Color: ${p.color}`).join('\n')}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          parts: [
            { text: "Compare this captured frame with the industrial database." },
            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
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

    return JSON.parse(response.text || '{}') as RecognitionResult;
  } catch (error) {
    console.error("Similarity Error:", error);
    return { matches: [], detectedFeatures: "Erro na análise profunda." };
  }
};

// --- Live Audio Helpers ---

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
