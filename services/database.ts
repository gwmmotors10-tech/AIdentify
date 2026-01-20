
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";
import { PartRecord } from "../types";

// Credenciais atualizadas com a API fornecida pelo usuário
const SUPABASE_URL = "https://sqefcgtihapowjguachy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxZWZjZ3RpaGFwb3dqZ3VhY2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMTYwNzIsImV4cCI6MjA4MjU5MjA3Mn0.Z-uBM4LRZrJkAwqoU1YKCrRrNTCQTcpXLLKaPCk-N7k";

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

export const initializeStorage = async () => {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data: buckets } = await client.storage.listBuckets();
    const exists = buckets?.some(b => b.id === BUCKET_NAME);
    
    if (!exists) {
      const { error } = await client.storage.createBucket(BUCKET_NAME, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
        fileSizeLimit: 5242880 // 5MB
      });
      if (error) console.warn("Aviso: Bucket 'parts-images' deve ser criado manualmente no painel do Supabase.", error.message);
    }
  } catch (e) {
    console.warn("Erro ao verificar/criar bucket:", e);
  }
};

async function base64ToBlob(base64: string): Promise<Blob> {
  const response = await fetch(base64);
  return await response.blob();
}

export const uploadImage = async (base64: string, path: string): Promise<string> => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Cliente Supabase não inicializado.");

  try {
    const blob = await base64ToBlob(base64);
    const sanitizedPath = path.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${sanitizedPath}/${crypto.randomUUID()}.jpg`;
    
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .upload(fileName, blob, { 
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: true 
      });

    if (error) throw new Error(`Erro no Storage: ${error.message}`);

    const { data: { publicUrl } } = client.storage
      .from(BUCKET_NAME)
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (err: any) {
    throw new Error(`Falha no upload da imagem: ${err.message}`);
  }
};

export const savePartToDB = async (part: PartRecord): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");

  try {
    const uploadedUrls = await Promise.all(
      part.imageUrls.map(async (url) => {
        if (url.startsWith('data:')) {
          return await uploadImage(url, part.partNumber || 'unnamed_part');
        }
        return url;
      })
    );

    const partToSave = {
      id: part.id,
      part_number: part.partNumber,
      part_name: part.partName,
      color: part.color,
      workstation: part.workstation,
      models: part.models || [],
      image_urls: uploadedUrls,
      timestamp: part.timestamp || Date.now()
    };

    const { error } = await client
      .from("parts")
      .upsert([partToSave], { onConflict: 'id' });

    if (error) throw new Error(`Erro no Banco de Dados: ${error.message}`);
  } catch (err: any) {
    console.error("Erro em savePartToDB:", err);
    throw err;
  }
};

export const getAllPartsFromDB = async (): Promise<PartRecord[]> => {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("parts")
    .select("*")
    .order("timestamp", { ascending: false });

  if (error) throw new Error(`Erro ao buscar dados: ${error.message}`);

  return (data || []).map(item => ({
    id: item.id,
    partNumber: item.part_number,
    partName: item.part_name,
    color: item.color,
    workstation: item.workstation,
    models: item.models || [],
    imageUrls: item.image_urls || [],
    timestamp: item.timestamp
  })) as PartRecord[];
};

export const deletePartFromDB = async (id: string): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.from("parts").delete().eq("id", id);
  if (error) throw new Error(`Erro ao excluir: ${error.message}`);
};
