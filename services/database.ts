
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
 * Tenta inicializar o bucket de storage se ele não existir.
 * Nota: Pode falhar se a chave anon não tiver permissões de admin, 
 * por isso o SQL manual é sempre recomendado.
 */
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
      if (error) console.warn("Aviso: Não foi possível criar o bucket via código. Certifique-se de criá-lo manualmente no painel do Supabase com o nome 'parts-images'.", error.message);
    }
  } catch (e) {
    console.warn("Erro ao verificar/criar bucket:", e);
  }
};

/**
 * Converte base64 para Blob de forma robusta
 */
async function base64ToBlob(base64: string): Promise<Blob> {
  const response = await fetch(base64);
  return await response.blob();
}

/**
 * Faz o upload de uma imagem base64 para o Supabase Storage e retorna a URL pública.
 */
export const uploadImage = async (base64: string, path: string): Promise<string> => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Cliente Supabase não inicializado.");

  try {
    const blob = await base64ToBlob(base64);
    
    // Sanitiza o path (remove caracteres que podem quebrar a URL do storage)
    const sanitizedPath = path.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${sanitizedPath}/${crypto.randomUUID()}.jpg`;
    
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .upload(fileName, blob, { 
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: true 
      });

    if (error) {
      console.error("Erro no Storage (Upload):", error);
      throw new Error(`Erro no Storage: ${error.message}. Verifique se o bucket '${BUCKET_NAME}' existe e tem políticas de RLS para INSERT.`);
    }

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
  if (!client) {
    throw new Error("Supabase não configurado. Verifique a URL e a KEY.");
  }

  try {
    // 1. Upload das imagens (apenas as novas que estão em base64)
    const uploadedUrls = await Promise.all(
      part.imageUrls.map(async (url) => {
        if (url.startsWith('data:')) {
          return await uploadImage(url, part.partNumber || 'unnamed_part');
        }
        return url;
      })
    );

    // 2. Mapeamento para o formato snake_case da tabela do Supabase
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

    if (error) {
      console.error("Erro no Database (Upsert):", error);
      throw new Error(`Erro no Banco de Dados: ${error.message}. Verifique as políticas de RLS para a tabela 'parts'.`);
    }
  } catch (err: any) {
    console.error("Erro completo em savePartToDB:", err);
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

  if (error) {
    console.error("Erro ao buscar peças:", error);
    throw new Error(`Erro ao buscar dados: ${error.message}`);
  }

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

  const { error } = await client
    .from("parts")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`Erro ao excluir: ${error.message}`);
};
