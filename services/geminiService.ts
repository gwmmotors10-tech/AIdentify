
import { GoogleGenAI, Type } from "@google/genai";
import { PartRecord, RecognitionResult } from "../types";

/**
 * Retorna uma nova instância do cliente GenAI. 
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
    // Adicionamos t=timestamp para evitar problemas de cache e ajudar com CORS em alguns ambientes
    const proxyUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(proxyUrl, { mode: 'cors' });
    
    if (!response.ok) {
      console.warn(`Falha ao buscar imagem para análise: ${url} (Status: ${response.status})`);
      return null;
    }
    
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
    console.error(`Erro de rede/CORS ao processar imagem para IA: ${url}`, e);
    return null;
  }
}

/**
 * Análise de similaridade multimodal (Imagem Alvo vs Banco de Dados)
 */
export const analyzeSimilarity = async (
  targetImageBase64: string,
  history: PartRecord[]
): Promise<RecognitionResult> => {
  const ai = getAIClient();
  const targetData = targetImageBase64.includes(',') ? targetImageBase64.split(',')[1] : targetImageBase64;

  // Filtrar apenas peças que têm imagens. Aumentamos o limite para 20 referências.
  const partsWithImages = history.filter(p => p.imageUrls && p.imageUrls.length > 0);
  if (partsWithImages.length === 0) {
    return { matches: [], detectedFeatures: "Nenhuma imagem de referência disponível no banco de dados para comparação." };
  }

  // Pegamos as últimas 20 peças cadastradas ou atualizadas
  const referenceParts = partsWithImages.slice(0, 20);
  const referenceImagesParts = await Promise.all(
    referenceParts.map(async (part) => {
      const base64 = await imageUrlToBase64(part.imageUrls[0]);
      if (!base64) return null;
      return [
        { text: `ID_PEÇA: ${part.id} | NOME: ${part.partName} | REF: ${part.partNumber}` },
        { inlineData: { mimeType: "image/jpeg", data: base64 } }
      ];
    })
  );

  const validRefs = referenceImagesParts.filter(Boolean).flat() as any[];

  if (validRefs.length === 0) {
    return { matches: [], detectedFeatures: "Não foi possível carregar as imagens de referência para comparação visual." };
  }

  const systemInstruction = `
    Você é um especialista em visão computacional industrial para a AIdentify.
    Sua tarefa é identificar peças industriais comparando uma imagem 'ALVO' com um conjunto de imagens de 'REFERÊNCIA'.
    
    INSTRUÇÕES:
    1. Analise cuidadosamente a geometria, furos, bordas e texturas.
    2. Ignore variações de iluminação.
    3. Para cada peça similar encontrada, atribua uma pontuação de 0 a 100.
    4. O ID no JSON deve ser exatamente o 'ID_PEÇA' fornecido no texto da referência.
    5. No campo 'detectedFeatures', descreva o diagnóstico da peça ALVO em português.

    RESPOSTA:
    Retorne EXCLUSIVAMENTE um objeto JSON válido.
    {
      "matches": [{"id": "UUID", "score": número, "reason": "motivo em português"}],
      "detectedFeatures": "diagnóstico técnico"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: "IMAGEM ALVO PARA IDENTIFICAÇÃO:" },
            { inlineData: { mimeType: "image/jpeg", data: targetData } },
            { text: "BANCO DE REFERÊNCIAS PARA COMPARAÇÃO:" },
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

    const resultText = response.text || '{}';
    // Limpeza de possíveis blocos de código que a IA possa retornar mesmo com schema
    const cleanedText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedText) as RecognitionResult;
  } catch (err: any) {
    console.error("Erro na chamada da API Gemini:", err);
    throw new Error(`Falha na análise da IA: ${err.message}`);
  }
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
