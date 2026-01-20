
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { PartRecord } from "../types";

// Credenciais fornecidas pelo usuário
const SUPABASE_URL = "https://sqefcgtihapowjguachy.supabase.co";
const SUPABASE_KEY = "sb_publishable_6BcgxqZUtUZyh7PD0gd45A_TyUdEALp";

let _supabase: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (_supabase) return _supabase;

  try {
    _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    return _supabase;
  } catch (e) {
    console.error("Erro ao inicializar Supabase:", e);
    return null;
  }
};

const BUCKET_NAME = "parts-images";

/**
 * Faz o upload de uma imagem base64 para o Supabase Storage e retorna a URL pública.
 */
export const uploadImage = async (base64: string, path: string): Promise<string> => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");

  // Converte base64 para Blob
  const res = await fetch(base64);
  const blob = await res.blob();
  
  const fileName = `${path}/${crypto.randomUUID()}.jpg`;
  
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .upload(fileName, blob, { 
      contentType: 'image/jpeg',
      upsert: true 
    });

  if (error) {
    console.error("Erro no upload do Storage:", error);
    throw error;
  }

  const { data: { publicUrl } } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(data.path);

  return publicUrl;
};

export const savePartToDB = async (part: PartRecord): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) {
    const localParts = JSON.parse(localStorage.getItem('parts_fallback') || '[]');
    const index = localParts.findIndex((p: any) => p.id === part.id);
    if (index > -1) localParts[index] = part;
    else localParts.push(part);
    localStorage.setItem('parts_fallback', JSON.stringify(localParts));
    return;
  }

  // Upload das imagens locais (base64) para o Storage antes de salvar os metadados
  const uploadedUrls = await Promise.all(
    part.imageUrls.map(url => url.startsWith('data:') ? uploadImage(url, part.partNumber) : url)
  );

  // Mapeamento para o formato snake_case do banco de dados
  const partToSave = {
    id: part.id,
    part_number: part.partNumber,
    part_name: part.partName,
    color: part.color,
    workstation: part.workstation,
    models: part.models,
    image_urls: uploadedUrls,
    timestamp: part.timestamp
  };

  const { error } = await client
    .from("parts")
    .upsert([partToSave]);

  if (error) throw error;
};

export const getAllPartsFromDB = async (): Promise<PartRecord[]> => {
  const client = getSupabaseClient();
  if (!client) {
    return JSON.parse(localStorage.getItem('parts_fallback') || '[]') as PartRecord[];
  }

  const { data, error } = await client
    .from("parts")
    .select("*")
    .order("timestamp", { ascending: false });

  if (error) throw error;

  // Mapeamento de volta para o formato CamelCase do TypeScript
  return data.map(item => ({
    id: item.id,
    partNumber: item.part_number,
    partName: item.part_name,
    color: item.color,
    workstation: item.workstation,
    models: item.models,
    imageUrls: item.image_urls,
    timestamp: item.timestamp
  })) as PartRecord[];
};

export const deletePartFromDB = async (id: string): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) {
    const localParts = JSON.parse(localStorage.getItem('parts_fallback') || '[]');
    localStorage.setItem('parts_fallback', JSON.stringify(localParts.filter((p: any) => p.id !== id)));
    return;
  }

  const { error } = await client
    .from("parts")
    .delete()
    .eq("id", id);

  if (error) throw error;
};
