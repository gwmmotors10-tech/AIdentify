
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PartRecord, PartColor, PartModel, RecognitionResult } from './types';
import { analyzeSimilarity, getAIClient, encode, decode, decodeAudioData } from './services/geminiService';
import { getAllPartsFromDB, savePartToDB, deletePartFromDB, getSupabaseClient, initializeStorage } from './services/database';
import { Modality } from '@google/genai';
import CameraCapture from './components/CameraCapture';
import PartCard from './components/PartCard';
import * as XLSX from "https://esm.sh/xlsx";

const App: React.FC = () => {
  const [isLanding, setIsLanding] = useState(true);
  const [view, setView] = useState<'list' | 'add' | 'recognize' | 'assistant'>('list');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<RecognitionResult | null>(null);
  const [parts, setParts] = useState<PartRecord[]>([]);
  const [currentCapture, setCurrentCapture] = useState<string | null>(null);
  const [capturedAngles, setCapturedAngles] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [targetPartIdForPhoto, setTargetPartIdForPhoto] = useState<string | null>(null);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCloudConfigured, setIsCloudConfigured] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(true);
  
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [isLiveActive, setIsLiveActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);

  const [form, setForm] = useState({
    partNumber: '',
    partName: '',
    color: PartColor.HAMILTON_WHITE,
    workstation: '',
    models: [] as PartModel[]
  });

  useEffect(() => {
    const checkApiKey = async () => {
      // @ts-ignore
      if (window.aistudio) {
        // @ts-ignore
        const has = await window.aistudio.hasSelectedApiKey();
        // Além do check formal, verificamos se a variável process.env.API_KEY está presente
        const envHasKey = !!process.env.API_KEY;
        setHasApiKey(has || envHasKey);
      }
    };
    checkApiKey();
    
    // Configurações de Banco de Dados
    const client = getSupabaseClient();
    setIsCloudConfigured(!!client);
    if (client) initializeStorage();
    if (!isLanding) loadData();

    // Listener para quando o usuário volta para a aba (pode ter selecionado a chave)
    const handleFocus = () => checkApiKey();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isLanding]);

  const handleOpenApiKeyDialog = async () => {
    // @ts-ignore
    if (window.aistudio) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      // Assume sucesso imediato para melhorar UX, conforme regras
      setHasApiKey(true);
      setAnalysisError(null);
    }
  };

  const loadData = async () => {
    try {
      const data = await getAllPartsFromDB();
      setParts(data);
    } catch (e: any) {
      console.error("Error loading data:", e);
    }
  };

  const filteredParts = useMemo(() => {
    return parts.filter(p => 
      p.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.partName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [parts, searchTerm]);

  const handleCapture = async (img: string) => {
    if (targetPartIdForPhoto) {
      const part = parts.find(p => p.id === targetPartIdForPhoto);
      if (part) {
        setIsSaving(true);
        try {
          const updatedPart = { ...part, imageUrls: [...(part.imageUrls || []), img] };
          await savePartToDB(updatedPart);
          await loadData();
        } catch (e: any) {
          alert(`Erro ao salvar foto: ${e.message}`);
        } finally {
          setIsSaving(false);
        }
      }
      setTargetPartIdForPhoto(null);
    } else if (view === 'recognize') {
      setCurrentCapture(img);
      handleAnalyze(img);
    } else if (view === 'add') {
      setCapturedAngles(prev => [...prev, img]);
    }
    setIsCameraOpen(false);
  };

  const handleAnalyze = async (img: string) => {
    // Verificação robusta antes de chamar a IA
    // @ts-ignore
    const reallyHasKey = (window.aistudio && await window.aistudio.hasSelectedApiKey()) || !!process.env.API_KEY;
    
    if (!reallyHasKey) {
      setAnalysisError("A IA precisa de uma chave configurada para funcionar.");
      await handleOpenApiKeyDialog();
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    
    try {
      const result = await analyzeSimilarity(img, parts);
      setAnalysisResult(result);
      if (result.matches.length === 0) {
        setAnalysisError("Nenhuma peça correspondente encontrada no banco de dados.");
      }
    } catch (err: any) {
      console.error("Erro na análise:", err);
      if (err.message?.includes("API_KEY_MISSING") || err.message?.includes("entity was not found") || err.message?.includes("403") || err.message?.includes("401")) {
        setHasApiKey(false);
        setAnalysisError("Chave da IA inválida ou expirada. Clique em 'CONFIGURAR IA'.");
      } else {
        setAnalysisError(`Erro técnico: ${err.message}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    // @ts-ignore
    const reallyHasKey = (window.aistudio && await window.aistudio.hasSelectedApiKey()) || !!process.env.API_KEY;
    if (!reallyHasKey) {
      alert("Por favor, configure a IA no topo da página.");
      await handleOpenApiKeyDialog();
      return;
    }

    const userMsg = { role: 'user' as const, text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const ai = getAIClient();
      const chat = ai.chats.create({ 
        model: 'gemini-3-pro-preview',
        config: { 
          systemInstruction: `Você é o AIdentify Assistant. Ajude com informações industriais sobre as peças cadastradas: ${JSON.stringify(parts.map(p => ({ n: p.partName, ref: p.partNumber })))}`,
          thinkingConfig: { thinkingBudget: 16384 }
        } 
      });
      const response = await chat.sendMessage({ message: chatInput });
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || '' }]);
    } catch (e: any) {
      console.error(e);
      setChatMessages(prev => [...prev, { role: 'model', text: `Desculpe, ocorreu um erro ao processar sua pergunta: ${e.message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingPartId) {
        const existingPart = parts.find(p => p.id === editingPartId);
        if (existingPart) {
          const updatedPart: PartRecord = {
            ...existingPart,
            partNumber: form.partNumber,
            partName: form.partName,
            color: form.color,
            workstation: form.workstation,
            models: form.models,
            imageUrls: capturedAngles.length > 0 ? [...existingPart.imageUrls, ...capturedAngles] : existingPart.imageUrls,
          };
          await savePartToDB(updatedPart);
        }
      } else {
        const newPart: PartRecord = {
          id: crypto.randomUUID(),
          partNumber: form.partNumber,
          partName: form.partName,
          color: form.color,
          workstation: form.workstation,
          models: form.models,
          imageUrls: capturedAngles,
          timestamp: Date.now(),
        };
        await savePartToDB(newPart);
      }
      await loadData();
      resetForm();
      setView('list');
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditPart = (part: PartRecord) => {
    setEditingPartId(part.id);
    setForm({
      partNumber: part.partNumber,
      partName: part.partName,
      color: part.color,
      workstation: part.workstation,
      models: part.models || []
    });
    setCapturedAngles([]);
    setView('add');
  };

  const resetForm = () => {
    setForm({ partNumber: '', partName: '', color: PartColor.HAMILTON_WHITE, workstation: '', models: [] });
    setCapturedAngles([]);
    setCurrentCapture(null);
    setEditingPartId(null);
    setAnalysisError(null);
    setAnalysisResult(null);
  };

  const handleXlsxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSaving(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws);
        const newRecords: PartRecord[] = data.map((item: any) => ({
          id: crypto.randomUUID(),
          partNumber: String(item.partNumber || ''),
          partName: String(item.partName || ''),
          color: (item.color) as PartColor || PartColor.HAMILTON_WHITE,
          workstation: String(item.workstation || ''),
          models: item.models ? item.models.split(',') : [],
          imageUrls: [],
          timestamp: Date.now()
        }));
        for (const record of newRecords) await savePartToDB(record);
        await loadData();
        alert("Importação concluída com sucesso!");
      } catch (err: any) {
        alert(`Falha na importação: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const toggleLiveAudio = async () => {
    if (isLiveActive) {
      setIsLiveActive(false);
      liveSessionRef.current?.close();
      return;
    }
    
    // @ts-ignore
    const reallyHasKey = (window.aistudio && await window.aistudio.hasSelectedApiKey()) || !!process.env.API_KEY;
    if (!reallyHasKey) {
      await handleOpenApiKeyDialog();
      return;
    }

    try {
      const ai = getAIClient();
      let nextStartTime = 0;
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ 
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }
              }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (msg) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              nextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.start(nextStartTime);
              nextStartTime += buffer.duration;
            }
          },
          onerror: (e) => {
            console.error("Live Error Callback:", e);
            setIsLiveActive(false);
          }
        },
        config: { 
          responseModalities: [Modality.AUDIO],
          systemInstruction: "Você é um assistente industrial profissional para o AIdentify. Fale com clareza e autoridade técnica."
        }
      });
      liveSessionRef.current = await sessionPromise;
      setIsLiveActive(true);
    } catch (e) {
      console.error("Live Error Initial:", e);
      alert("Erro ao iniciar chat de voz. Verifique o microfone e a chave API.");
    }
  };

  const toggleModel = (m: PartModel) => {
    setForm(prev => ({
      ...prev,
      models: prev.models.includes(m) ? prev.models.filter(item => item !== m) : [...prev.models, m]
    }));
  };

  const deletePart = async (id: string) => {
    if (confirm("Deseja realmente excluir este registro? Esta ação é irreversível.")) {
      try {
        await deletePartFromDB(id);
        setParts(prev => prev.filter(p => p.id !== id));
      } catch (e: any) {
        alert(`Erro ao excluir: ${e.message}`);
      }
    }
  };

  if (isLanding) {
    return (
      <div className="relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-black">
        <div className="absolute top-[42%] left-[34%] headlight-flare scale-125"></div>
        <div className="absolute top-[42%] left-[36%] beam opacity-40" style={{ transform: 'rotate(5deg)' }}></div>
        <div className="absolute top-[42%] left-[58%] headlight-flare scale-125"></div>
        <div className="absolute top-[42%] left-[56%] beam opacity-40" style={{ transform: 'rotate(175deg)', transformOrigin: 'right center' }}></div>
        <div className="z-10 text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000">
           <div className="space-y-2">
             <h1 className="text-8xl font-brand font-bold tracking-tighter text-white drop-shadow-[0_0_50px_rgba(245,158,11,0.6)]">
               A<span className="text-amber-500">IDENTIFY</span>
             </h1>
             <p className="text-sm font-bold tracking-[0.6em] text-amber-500 uppercase">Industrial Intelligence AI</p>
           </div>
           <div className="pt-16">
              <button 
                onClick={() => setIsLanding(false)}
                className="group relative px-12 py-5 bg-transparent text-white font-bold uppercase tracking-widest text-xs rounded-full overflow-hidden transition-all active:scale-95"
              >
                <div className="absolute inset-0 bg-amber-500 group-hover:bg-amber-400 transition-colors"></div>
                <span className="relative z-10 text-black">ACESSAR SISTEMA</span>
              </button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 text-zinc-100">
      {(!isCloudConfigured || !hasApiKey) && (
        <div className="bg-amber-500/20 border-b border-amber-500/50 p-2 flex justify-center items-center gap-4 text-[10px] font-bold text-amber-500 uppercase tracking-widest sticky top-0 z-[60] backdrop-blur-sm">
          {!isCloudConfigured && <span>⚠️ ERRO DE CONEXÃO COM BANCO</span>}
          {!hasApiKey && (
            <div className="flex items-center gap-2">
              <span>⚠️ IA NÃO CONFIGURADA</span>
              <button onClick={handleOpenApiKeyDialog} className="bg-amber-500 text-black px-3 py-1 rounded-md hover:bg-amber-400 transition-colors">
                CONFIGURAR IA AGORA
              </button>
            </div>
          )}
        </div>
      )}

      {isSaving && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center">
           <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent animate-spin rounded-full mb-4"></div>
           <p className="text-amber-500 font-brand font-bold tracking-widest animate-pulse">SINCRONIZANDO COM A NUVEM...</p>
        </div>
      )}

      <header className="glass sticky top-0 z-40 px-4 py-6 border-b border-white/10 shadow-2xl">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="cursor-pointer" onClick={() => setView('list')}>
            <h1 className="text-3xl font-brand font-bold tracking-tighter text-white">
              A<span className="text-amber-500">IDENTIFY</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setView('recognize'); resetForm(); }}
              className="bg-amber-500 text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-amber-400 transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2"/></svg>
              SCANNER IA
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {view === 'list' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-4xl font-brand font-bold text-white tracking-tight">Inventário de Peças</h2>
                <p className="text-zinc-500 text-xs font-mono mt-1 tracking-widest uppercase">{parts.length} Peças no Banco de Dados</p>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Buscar por nome ou Part Number..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-amber-500 w-64 md:w-80 transition-all"
                />
              </div>
            </div>
            
            {parts.length === 0 ? (
              <div className="glass p-20 rounded-3xl text-center border border-dashed border-white/10">
                <p className="text-zinc-500 uppercase font-bold tracking-widest mb-4">O banco de dados está vazio</p>
                <button onClick={() => setView('add')} className="text-amber-500 border border-amber-500/50 px-6 py-2 rounded-full text-xs font-bold hover:bg-amber-500/10 transition-colors">ADICIONAR PRIMEIRA PEÇA</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredParts.map(part => (
                  <div key={part.id} className="relative group">
                    <PartCard 
                      part={part} 
                      onAddPhoto={() => { setTargetPartIdForPhoto(part.id); setIsCameraOpen(true); }}
                      onEdit={() => handleEditPart(part)}
                    />
                    <button 
                      onClick={(e) => { e.stopPropagation(); deletePart(part.id); }}
                      className="absolute top-2 right-2 p-1.5 bg-red-900/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 border border-red-500/50 z-20"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'recognize' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-center gap-4">
              <button onClick={() => setView('list')} className="w-10 h-10 rounded-full glass flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 19l-7-7 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <h2 className="text-3xl font-brand font-bold tracking-tighter">IDENTIFICAÇÃO POR IMAGEM</h2>
            </div>
            
            {!currentCapture ? (
               <div onClick={() => setIsCameraOpen(true)} className="w-full aspect-video rounded-3xl glass border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-amber-500/50 hover:bg-white/5 transition-all group">
                  <div className="w-24 h-24 glass border border-white/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform group-hover:shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                    <svg className="h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </div>
                  <p className="text-xl font-bold text-white mb-2 uppercase tracking-widest">Capturar Peça para Análise</p>
                  <p className="text-zinc-500 text-xs uppercase tracking-widest">A IA comparará com as imagens do banco de dados</p>
               </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <div className="relative group">
                    <img src={currentCapture} className="rounded-3xl border border-white/10 shadow-2xl w-full aspect-square object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                      <p className="text-white font-bold text-xs uppercase tracking-widest">Imagem Capturada</p>
                    </div>
                  </div>
                  <button onClick={() => { setCurrentCapture(null); setAnalysisResult(null); setAnalysisError(null); setIsCameraOpen(true); }} className="w-full py-4 glass border border-white/10 text-zinc-400 font-bold uppercase text-[10px] tracking-widest rounded-2xl hover:bg-white/5 transition-colors">Capturar Novamente</button>
                </div>
                <div className="space-y-6">
                   {isAnalyzing ? (
                     <div className="glass p-12 rounded-3xl text-center space-y-6 h-full flex flex-col justify-center border-amber-500/20">
                        <div className="relative w-20 h-20 mx-auto">
                          <div className="absolute inset-0 border-4 border-amber-500/20 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-amber-500 border-t-transparent animate-spin rounded-full"></div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-amber-500 font-brand font-bold animate-pulse text-lg tracking-widest uppercase">Processando Imagem...</p>
                          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em]">IA Industrial em Operação</p>
                        </div>
                     </div>
                   ) : (
                     <div className="space-y-6 animate-in fade-in duration-700">
                        {analysisError && (
                          <div className="glass p-6 rounded-2xl border-l-4 border-red-500 text-red-400 text-xs font-bold uppercase tracking-widest flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="2"/></svg>
                              <span>{analysisError}</span>
                            </div>
                            {analysisError.includes("Chave") && (
                              <button onClick={handleOpenApiKeyDialog} className="bg-red-500 text-white px-4 py-2 rounded-lg text-[10px] hover:bg-red-600 transition-colors w-fit">RECONFIGURAR AGORA</button>
                            )}
                          </div>
                        )}
                        {analysisResult && (
                          <>
                            <div className="glass p-6 rounded-2xl border-l-4 border-amber-500 shadow-xl">
                              <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="2"/></svg>
                                Diagnóstico da IA
                              </h4>
                              <p className="text-sm text-zinc-300 leading-relaxed font-medium">{analysisResult.detectedFeatures}</p>
                            </div>
                            <div className="space-y-4">
                              <h4 className="text-[10px] font-bold text-white uppercase tracking-widest border-b border-white/10 pb-2 flex justify-between">
                                <span>Peças Similares Encontradas</span>
                                <span className="text-zinc-500">Confidence Match</span>
                              </h4>
                              <div className="grid gap-4">
                                {analysisResult.matches.length > 0 ? (
                                  analysisResult.matches.map(m => {
                                    const part = parts.find(p => p.id === m.id);
                                    if (!part) return null;
                                    return <PartCard key={m.id} part={part} similarity={m.score} reason={m.reason} isHighConfidence={m.score >= 75} />;
                                  })
                                ) : !analysisError && (
                                  <div className="glass p-8 rounded-2xl text-center">
                                    <p className="text-xs text-zinc-500 italic">Nenhuma correspondência visual encontrada no banco de dados.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                     </div>
                   )}
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'assistant' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto h-[75vh] animate-in slide-in-from-bottom-8 duration-500">
            <div className="lg:col-span-2 flex flex-col glass rounded-[40px] border border-white/10 overflow-hidden shadow-3xl">
              <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-black shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2"/></svg>
                  </div>
                  <div>
                    <h3 className="font-brand font-bold text-white text-sm tracking-widest uppercase">Expert Assistant</h3>
                    <p className="text-[8px] text-zinc-500 uppercase tracking-widest">Baseado em Gemini 3 Pro</p>
                  </div>
                </div>
                {isChatLoading && <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent animate-spin rounded-full"></div>}
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                    <svg className="w-16 h-16 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth="1.5"/></svg>
                    <p className="text-xs font-bold uppercase tracking-widest">Inicie uma conversa técnica</p>
                  </div>
                ) : (
                  chatMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed shadow-xl ${m.role === 'user' ? 'bg-amber-500 text-black font-bold rounded-tr-none' : 'glass border border-white/10 text-zinc-100 rounded-tl-none'}`}>
                        {m.text}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-5 bg-black/20 flex gap-3 border-t border-white/5">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSendMessage()} placeholder="Perguntar sobre as peças, cores ou workstations..." className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm outline-none focus:border-amber-500 transition-colors placeholder:text-zinc-700" />
                <button onClick={handleSendMessage} className="bg-amber-500 text-black px-8 rounded-2xl font-bold hover:bg-amber-400 transition-all active:scale-95 shadow-lg">ENVIAR</button>
              </div>
            </div>

            <div className="flex flex-col glass rounded-[40px] border border-white/10 items-center justify-center p-12 space-y-8 text-center shadow-3xl">
               <div className="space-y-2">
                 <h3 className="font-brand font-bold text-white text-lg tracking-widest uppercase">Voz Industrial</h3>
                 <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Interação em Tempo Real</p>
               </div>
               <div className={`w-40 h-40 rounded-full border-4 flex items-center justify-center transition-all duration-500 ${isLiveActive ? 'border-amber-500 animate-pulse bg-amber-500/10 shadow-[0_0_50px_rgba(245,158,11,0.2)]' : 'border-zinc-800 bg-white/5'}`}>
                 <svg className={`h-16 w-16 transition-colors ${isLiveActive ? 'text-amber-500' : 'text-zinc-700'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeWidth="2"/><path d="M19 10v1a7 7 0 01-14 0v-1" strokeWidth="2"/></svg>
               </div>
               <button onClick={toggleLiveAudio} className={`w-full py-6 rounded-3xl font-bold uppercase tracking-[0.2em] text-[10px] shadow-2xl transition-all ${isLiveActive ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-amber-500 text-black hover:bg-amber-400'}`}>
                 {isLiveActive ? 'Encerrar Chamada' : 'Iniciar Assistente por Voz'}
               </button>
               <div className="pt-4">
                 <p className="text-[9px] text-zinc-600 uppercase tracking-widest leading-relaxed">O assistente por voz possui baixa latência e conhecimento da base de dados local.</p>
               </div>
            </div>
          </div>
        )}

        {view === 'add' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500 pb-12">
            {!editingPartId && (
              <div className="glass p-8 rounded-[40px] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-3xl">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                    <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2"/></svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-brand font-bold uppercase tracking-tighter">Importação em Massa</h3>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Suporta arquivos Excel .xlsx</p>
                  </div>
                </div>
                <label className="bg-amber-500 text-black px-8 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-amber-400 transition-all shadow-lg active:scale-95">
                  Selecionar Arquivo
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleXlsxUpload} />
                </label>
              </div>
            )}

            <form onSubmit={handleSubmit} className="glass p-12 rounded-[50px] border border-white/10 space-y-12 shadow-3xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <svg className="w-32 h-32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth="1"/></svg>
              </div>
              
              <div className="border-b border-white/5 pb-6">
                <h2 className="text-4xl font-brand font-bold tracking-tighter uppercase text-white">
                  {editingPartId ? 'Editar Registro' : 'Cadastro de Peça'}
                </h2>
                <p className="text-[10px] text-zinc-500 uppercase tracking-[0.4em] mt-2">Especificação Técnica e Visual</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                 <div className="space-y-8">
                   <div>
                    <label className="text-[10px] font-bold text-amber-500 uppercase tracking-widest block mb-4">Galeria de Ângulos (Máx. 6)</label>
                    <div className="grid grid-cols-2 gap-4">
                      {capturedAngles.map((img, idx) => (
                        <div key={idx} className="relative aspect-square rounded-3xl overflow-hidden border border-white/10 shadow-lg group">
                          <img src={img} className="w-full h-full object-cover" />
                          <button type="button" onClick={() => setCapturedAngles(prev => prev.filter((_, i) => i !== idx))} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth="2.5"/></svg>
                          </button>
                        </div>
                      ))}
                      {capturedAngles.length < 6 && (
                        <button type="button" onClick={() => setIsCameraOpen(true)} className="aspect-square glass border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center gap-3 hover:border-amber-500/50 hover:bg-white/5 transition-all group">
                          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth="2"/></svg>
                          </div>
                          <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Nova Foto</span>
                        </button>
                      )}
                    </div>
                   </div>
                 </div>

                 <div className="space-y-6">
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest ml-4 mb-2 block">Identificação</label>
                      <div className="space-y-3">
                        <input required placeholder="Part Number (ex: PN-12345)" className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-sm outline-none focus:border-amber-500 transition-colors" value={form.partNumber} onChange={e => setForm({...form, partNumber: e.target.value})} />
                        <input required placeholder="Part Name (ex: Parachoque Dianteiro)" className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-sm outline-none focus:border-amber-500 transition-colors" value={form.partName} onChange={e => setForm({...form, partName: e.target.value})} />
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest ml-4 mb-2 block">Especificação</label>
                      <div className="space-y-3">
                        <select className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-sm outline-none focus:border-amber-500 transition-colors appearance-none" value={form.color} onChange={e => setForm({...form, color: e.target.value as PartColor})}>
                          {Object.values(PartColor).map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
                        </select>
                        <input required placeholder="Workstation (ex: A-12)" className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-sm outline-none focus:border-amber-500 transition-colors" value={form.workstation} onChange={e => setForm({...form, workstation: e.target.value})} />
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest ml-4 mb-2 block">Modelos Compatíveis</label>
                      <div className="grid grid-cols-2 gap-2">
                         {Object.values(PartModel).map(m => (
                           <button key={m} type="button" onClick={() => toggleModel(m)} className={`px-4 py-3 rounded-xl text-[9px] font-bold transition-all border shadow-md ${form.models.includes(m) ? 'bg-amber-500 text-black border-amber-500 shadow-amber-500/20' : 'bg-white/5 text-zinc-500 border-white/10 hover:border-white/30'}`}>{m}</button>
                         ))}
                      </div>
                    </div>
                 </div>
              </div>
              
              <div className="flex gap-6 pt-8 border-t border-white/5">
                <button type="button" onClick={() => { resetForm(); setView('list'); }} className="flex-1 py-5 glass text-zinc-500 font-bold uppercase text-[10px] tracking-[0.3em] rounded-2xl hover:bg-white/10 transition-colors">CANCELAR</button>
                <button type="submit" disabled={isSaving} className="flex-[2] py-5 bg-amber-500 text-black font-bold uppercase text-[10px] tracking-[0.3em] rounded-2xl shadow-2xl hover:bg-amber-400 transition-all active:scale-95">FINALIZAR E SALVAR</button>
              </div>
            </form>
          </div>
        )}
      </main>

      <nav className="fixed bottom-8 inset-x-0 mx-auto max-w-md glass rounded-[35px] px-8 py-5 flex justify-between items-center z-[100] border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] mx-4 sm:mx-auto">
        <button onClick={() => setView('list')} className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${view === 'list' ? 'text-amber-500' : 'text-zinc-600 hover:text-zinc-400'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeWidth="2"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Base</span>
        </button>
        
        <div className="relative">
          <button onClick={() => { setView('recognize'); resetForm(); }} className={`bg-amber-500 text-black w-18 h-18 -mt-20 rounded-3xl flex items-center justify-center shadow-[0_10px_30px_rgba(245,158,11,0.5)] border-4 border-black transition-transform active:scale-90 p-5 ${view === 'recognize' ? 'scale-110' : ''}`}>
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2.5"/></svg>
          </button>
        </div>

        <button onClick={() => setView('assistant')} className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${view === 'assistant' ? 'text-amber-500' : 'text-zinc-600 hover:text-zinc-400'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Chat</span>
        </button>
        
        <button onClick={() => { setView('add'); resetForm(); }} className={`flex flex-col items-center gap-1.5 transition-all active:scale-90 ${view === 'add' ? 'text-amber-500' : 'text-zinc-600 hover:text-zinc-400'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth="2"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Novo</span>
        </button>
      </nav>

      {isCameraOpen && <CameraCapture onCapture={handleCapture} onCancel={() => { setIsCameraOpen(false); setTargetPartIdForPhoto(null); }} />}
    </div>
  );
};

export default App;
