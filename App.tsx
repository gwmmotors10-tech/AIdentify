
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PartRecord, PartColor, PartModel, RecognitionResult } from './types';
import { analyzeSimilarity, getAIClient, encode, decode, decodeAudioData } from './services/geminiService';
import { getAllPartsFromDB, savePartToDB, deletePartFromDB, getSupabaseClient, initializeStorage } from './services/database';
import { Modality } from '@google/genai';
import CameraCapture from './components/CameraCapture';
import PartCard from './components/PartCard';
import * as XLSX from "https://esm.sh/xlsx";

// Removed redundant AIStudio interface and global Window augmentation 
// as it is already pre-configured in the environment and causing conflict errors.

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
      // @ts-ignore - window.aistudio is pre-configured
      if (window.aistudio) {
        // @ts-ignore
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      }
    };
    checkApiKey();
    
    const client = getSupabaseClient();
    setIsCloudConfigured(!!client);
    if (client) initializeStorage();
    if (!isLanding) loadData();
  }, [isLanding]);

  const handleOpenApiKeyDialog = async () => {
    // @ts-ignore
    if (window.aistudio) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
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
    if (!hasApiKey) {
      alert("Por favor, configure a chave da IA antes de analisar.");
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
      console.error(err);
      if (err.message?.includes("API_KEY_MISSING") || err.message?.includes("entity was not found")) {
        setHasApiKey(false);
        setAnalysisError("Chave API ausente ou inválida. Por favor, reconfigure.");
      } else {
        setAnalysisError(`Erro na análise: ${err.message}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !hasApiKey) return;
    const userMsg = { role: 'user' as const, text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const ai = getAIClient();
      const chat = ai.chats.create({ 
        model: 'gemini-3-pro-preview',
        config: { 
          systemInstruction: `Você é o AIdentify Assistant. Ajude com informações industriais. Peças: ${JSON.stringify(parts.map(p => p.partName))}`,
          thinkingConfig: { thinkingBudget: 16384 }
        } 
      });
      const response = await chat.sendMessage({ message: chatInput });
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || '' }]);
    } catch (e) {
      console.error(e);
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
        alert("Importação concluída!");
      } catch (err: any) {
        alert(`Falha: ${err.message}`);
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
    if (!hasApiKey) {
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
          }
        },
        config: { 
          responseModalities: [Modality.AUDIO],
          systemInstruction: "Você é um assistente industrial profissional para o AIdentify."
        }
      });
      liveSessionRef.current = await sessionPromise;
      setIsLiveActive(true);
    } catch (e) {
      console.error("Live Error:", e);
    }
  };

  const toggleModel = (m: PartModel) => {
    setForm(prev => ({
      ...prev,
      models: prev.models.includes(m) ? prev.models.filter(item => item !== m) : [...prev.models, m]
    }));
  };

  const deletePart = async (id: string) => {
    if (confirm("Confirmar exclusão?")) {
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
        <div className="bg-red-500/20 border-b border-red-500/50 p-2 flex justify-center items-center gap-4 text-[10px] font-bold text-red-500 uppercase tracking-widest sticky top-0 z-[60] backdrop-blur-sm">
          {!isCloudConfigured && <span>⚠️ ERRO DE BANCO DE DADOS</span>}
          {!hasApiKey && (
            <button onClick={handleOpenApiKeyDialog} className="bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600 transition-colors">
              CONFIGURAR CHAVE IA
            </button>
          )}
        </div>
      )}

      {isSaving && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center">
           <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent animate-spin rounded-full mb-4"></div>
           <p className="text-amber-500 font-brand font-bold tracking-widest animate-pulse">SINCRONIZANDO...</p>
        </div>
      )}

      <header className="glass sticky top-0 z-40 px-4 py-6 border-b border-white/10 shadow-2xl">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="cursor-pointer" onClick={() => setView('list')}>
            <h1 className="text-3xl font-brand font-bold tracking-tighter text-white">
              A<span className="text-amber-500">IDENTIFY</span>
            </h1>
          </div>
          <button 
            onClick={() => { setView('recognize'); resetForm(); }}
            className="bg-amber-500 text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-amber-400 transition-all shadow-lg active:scale-95"
          >
            AI SCAN
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {view === 'list' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-4xl font-brand font-bold text-white tracking-tight">Inventário Vision</h2>
                <p className="text-zinc-500 text-xs font-mono mt-1 tracking-widest uppercase">{parts.length} Peças Cadastradas</p>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Buscar Peça..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-amber-500 w-64 transition-all"
                />
              </div>
            </div>
            
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
                    className="absolute top-2 right-2 p-1.5 bg-red-900/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 border border-red-500/50"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'recognize' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-center gap-4">
              <button onClick={() => setView('list')} className="w-10 h-10 rounded-full glass flex items-center justify-center text-zinc-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 19l-7-7 7-7" strokeWidth="2"/></svg>
              </button>
              <h2 className="text-3xl font-brand font-bold">Diagnóstico Profundo</h2>
            </div>
            
            {!currentCapture ? (
               <div onClick={() => setIsCameraOpen(true)} className="w-full aspect-video rounded-3xl glass border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-amber-500/50 hover:bg-white/5 transition-all group">
                  <div className="w-20 h-20 glass border border-white/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <svg className="h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  </div>
                  <p className="text-xl font-bold text-white mb-2">Iniciar Scanner Profissional</p>
               </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <img src={currentCapture} className="rounded-3xl border border-white/10 shadow-2xl w-full aspect-square object-cover" />
                  <button onClick={() => { setCurrentCapture(null); setAnalysisResult(null); setAnalysisError(null); setIsCameraOpen(true); }} className="w-full py-4 glass border border-white/10 text-zinc-400 font-bold uppercase text-xs tracking-widest rounded-2xl">Nova Captura</button>
                </div>
                <div className="space-y-6">
                   {isAnalyzing ? (
                     <div className="glass p-12 rounded-3xl text-center space-y-4 h-full flex flex-col justify-center">
                        <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent animate-spin rounded-full mx-auto mb-4"></div>
                        <p className="text-amber-500 font-brand font-bold animate-pulse text-lg">IA ANALISANDO IMAGENS...</p>
                     </div>
                   ) : (
                     <div className="space-y-6">
                        {analysisError && (
                          <div className="glass p-6 rounded-2xl border-l-4 border-red-500 text-red-400 text-sm font-bold uppercase tracking-widest">
                            {analysisError}
                          </div>
                        )}
                        {analysisResult && (
                          <>
                            <div className="glass p-6 rounded-2xl border-l-4 border-amber-500">
                              <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">Diagnóstico AI</h4>
                              <p className="text-sm text-zinc-300 leading-relaxed font-medium">{analysisResult.detectedFeatures}</p>
                            </div>
                            <div className="space-y-4">
                              <h4 className="text-xs font-bold text-white uppercase tracking-widest border-b border-white/10 pb-2">Resultados Similares</h4>
                              <div className="grid gap-4">
                                {analysisResult.matches.length > 0 ? (
                                  analysisResult.matches.map(m => {
                                    const part = parts.find(p => p.id === m.id);
                                    if (!part) return null;
                                    return <PartCard key={m.id} part={part} similarity={m.score} reason={m.reason} isHighConfidence={m.score >= 70} />;
                                  })
                                ) : !analysisError && (
                                  <p className="text-xs text-zinc-500 italic">Nenhum resultado similar encontrado.</p>
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto h-[75vh]">
            <div className="lg:col-span-2 flex flex-col glass rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-white/5 bg-white/5 flex justify-between items-center">
                <h3 className="font-brand font-bold text-white text-sm tracking-widest uppercase">Agente Especialista</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-amber-500 text-black font-bold' : 'glass border border-white/10 text-zinc-100'}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-black/20 flex gap-3">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSendMessage()} placeholder="Perguntar sobre peças..." className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm outline-none focus:border-amber-500 transition-colors" />
                <button onClick={handleSendMessage} className="bg-amber-500 text-black px-5 rounded-2xl font-bold">ENVIAR</button>
              </div>
            </div>

            <div className="flex flex-col glass rounded-3xl border border-white/10 items-center justify-center p-10 space-y-8 text-center shadow-2xl">
               <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center ${isLiveActive ? 'border-amber-500 animate-pulse bg-amber-500/10' : 'border-zinc-800'}`}>
                 <svg className={`h-12 w-12 ${isLiveActive ? 'text-amber-500' : 'text-zinc-700'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v1a7 7 0 01-14 0v-1" strokeWidth="2"/></svg>
               </div>
               <button onClick={toggleLiveAudio} className={`w-full py-5 rounded-2xl font-bold uppercase tracking-widest text-[10px] ${isLiveActive ? 'bg-red-500/20 text-red-500' : 'bg-amber-500 text-black'}`}>
                 {isLiveActive ? 'PARAR CHAMADA' : 'ASSISTENTE DE VOZ'}
               </button>
            </div>
          </div>
        )}

        {view === 'add' && (
          <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
            {!editingPartId && (
              <div className="glass p-8 rounded-[40px] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
                <div>
                  <h3 className="text-xl font-brand font-bold uppercase">Importação XLSX</h3>
                  <p className="text-xs text-zinc-500">Upload de dados em massa</p>
                </div>
                <label className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest cursor-pointer hover:bg-white/10 transition-all">
                  Selecionar XLSX
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleXlsxUpload} />
                </label>
              </div>
            )}

            <form onSubmit={handleSubmit} className="glass p-10 rounded-[40px] border border-white/10 space-y-10 shadow-3xl">
              <div className="border-b border-white/5 pb-4">
                <h2 className="text-3xl font-brand font-bold tracking-tighter uppercase">{editingPartId ? 'Editar Registro' : 'Novo Registro'}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                 <div className="space-y-6">
                   <label className="text-[10px] font-bold text-amber-500 uppercase tracking-widest block mb-2">Fotos da Peça</label>
                   <div className="grid grid-cols-2 gap-3">
                     {capturedAngles.map((img, idx) => (
                       <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border border-white/10 group">
                         <img src={img} className="w-full h-full object-cover" />
                       </div>
                     ))}
                     {capturedAngles.length < 6 && (
                       <button type="button" onClick={() => setIsCameraOpen(true)} className="aspect-square glass border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-2">
                         <svg className="h-8 w-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" /></svg>
                       </button>
                     )}
                   </div>
                 </div>
                 <div className="space-y-5">
                    <input required placeholder="Part Number" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.partNumber} onChange={e => setForm({...form, partNumber: e.target.value})} />
                    <input required placeholder="Part Name" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.partName} onChange={e => setForm({...form, partName: e.target.value})} />
                    <select className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.color} onChange={e => setForm({...form, color: e.target.value as PartColor})}>
                      {Object.values(PartColor).map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
                    </select>
                    <input required placeholder="Workstation" className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.workstation} onChange={e => setForm({...form, workstation: e.target.value})} />
                    <div className="grid grid-cols-2 gap-2">
                         {Object.values(PartModel).map(m => (
                           <button key={m} type="button" onClick={() => toggleModel(m)} className={`px-3 py-2 rounded-xl text-[9px] font-bold transition-all border ${form.models.includes(m) ? 'bg-amber-500 text-black border-amber-500' : 'bg-white/5 text-zinc-400 border-white/10'}`}>{m}</button>
                         ))}
                      </div>
                 </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => resetForm()} className="flex-1 py-4 glass text-zinc-500 font-bold uppercase text-[10px] tracking-widest rounded-2xl">DESCARTAR</button>
                <button type="submit" disabled={isSaving} className="flex-[2] py-4 bg-amber-500 text-black font-bold uppercase text-[10px] tracking-widest rounded-2xl shadow-xl hover:bg-amber-400 transition-all">SALVAR REGISTRO</button>
              </div>
            </form>
          </div>
        )}
      </main>

      <nav className="fixed bottom-8 inset-x-0 mx-auto max-w-md glass rounded-[32px] px-8 py-5 flex justify-between items-center z-40 border border-white/10 shadow-2xl">
        <button onClick={() => setView('list')} className={`flex flex-col items-center gap-1 transition-all ${view === 'list' ? 'text-amber-500' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          <span className="text-[8px] font-bold">BASE</span>
        </button>
        <button onClick={() => { setView('recognize'); resetForm(); }} className="bg-amber-500 text-black w-16 h-16 -mt-16 rounded-[22px] flex items-center justify-center shadow-2xl border-4 border-black/80">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </button>
        <button onClick={() => setView('assistant')} className={`flex flex-col items-center gap-1 transition-all ${view === 'assistant' ? 'text-amber-500' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span className="text-[8px] font-bold">ASSISTENTE</span>
        </button>
        <button onClick={() => { setView('add'); resetForm(); }} className={`flex flex-col items-center gap-1 transition-all ${view === 'add' ? 'text-amber-500' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 5v14m-7-7h14"/></svg>
          <span className="text-[8px] font-bold">ADICIONAR</span>
        </button>
      </nav>

      {isCameraOpen && <CameraCapture onCapture={handleCapture} onCancel={() => { setIsCameraOpen(false); setTargetPartIdForPhoto(null); }} />}
    </div>
  );
};

export default App;
