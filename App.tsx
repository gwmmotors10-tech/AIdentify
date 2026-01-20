
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
  const [analysisResult, setAnalysisResult] = useState<RecognitionResult | null>(null);
  const [parts, setParts] = useState<PartRecord[]>([]);
  const [currentCapture, setCurrentCapture] = useState<string | null>(null);
  const [capturedAngles, setCapturedAngles] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [targetPartIdForPhoto, setTargetPartIdForPhoto] = useState<string | null>(null);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCloudConfigured, setIsCloudConfigured] = useState(true);
  
  // Chat State
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Live Audio State
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

  // Check configuration and load parts on mount
  useEffect(() => {
    const client = getSupabaseClient();
    setIsCloudConfigured(!!client);
    
    if (client) {
      initializeStorage();
    }

    if (!isLanding) {
      loadData();
    }
  }, [isLanding]);

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
          const updatedPart = {
            ...part,
            imageUrls: [...(part.imageUrls || []), img]
          };
          await savePartToDB(updatedPart);
          await loadData();
        } catch (e: any) {
          console.error("Capture Save Error:", e);
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
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const result = await analyzeSimilarity(img, parts);
      setAnalysisResult(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { role: 'user' as const, text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const ai = getAIClient();
      const chat = ai.chats.create({ 
        model: 'gemini-3-pro-preview',
        config: { 
          systemInstruction: `You are AIdentify Assistant. Help users with industrial information. Current parts: ${JSON.stringify(parts.map(p => p.partName))}`,
          thinkingConfig: { thinkingBudget: 32768 }
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
      console.error("Submit Error:", err);
      alert(`Falha ao salvar no banco de dados: ${err.message}`);
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
    setForm({
      partNumber: '',
      partName: '',
      color: PartColor.HAMILTON_WHITE,
      workstation: '',
      models: []
    });
    setCapturedAngles([]);
    setCurrentCapture(null);
    setEditingPartId(null);
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
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const newRecords: PartRecord[] = data.map((item: any) => {
          let rawModels = item.model || item.models || item['Model'] || item['Models'] || '';
          let modelsArray = typeof rawModels === 'string' ? rawModels.split(',').map(m => m.trim()) as PartModel[] : [rawModels as PartModel];
          return {
            id: crypto.randomUUID(),
            partNumber: String(item.partNumber || item['Part Number'] || ''),
            partName: String(item.partName || item['Part Name'] || ''),
            color: (item.color || item['Color']) as PartColor || PartColor.HAMILTON_WHITE,
            workstation: String(item.workstation || item['Workstation'] || ''),
            models: modelsArray,
            imageUrls: [],
            timestamp: Date.now()
          };
        });

        for (const record of newRecords) {
          await savePartToDB(record);
        }
        await loadData();
        alert("Importação concluída com sucesso!");
      } catch (err: any) {
        console.error("XLSX Error:", err);
        alert(`Falha na importação XLSX: ${err.message}`);
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
          systemInstruction: "You are a hands-free industrial assistant for AIdentify. Be brief and professional."
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
      models: prev.models.includes(m) 
        ? prev.models.filter(item => item !== m)
        : [...prev.models, m]
    }));
  };

  const deletePart = async (id: string) => {
    if (confirm("Confirmar exclusão? (确认删除?)")) {
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
             <p className="text-sm font-bold tracking-[0.6em] text-amber-500 uppercase">
               Deep Industrial Vision (深度工业视觉)
             </p>
           </div>
           
           <div className="pt-16">
              <button 
                onClick={() => setIsLanding(false)}
                className="group relative px-12 py-5 bg-transparent text-white font-bold uppercase tracking-widest text-xs rounded-full overflow-hidden transition-all active:scale-95"
              >
                <div className="absolute inset-0 bg-amber-500 group-hover:bg-amber-400 transition-colors"></div>
                <span className="relative z-10 text-black">ACCESS SYSTEM (进入系统)</span>
              </button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 text-zinc-100">
      {!isCloudConfigured && (
        <div className="bg-red-500/20 border-b border-red-500/50 p-2 text-center text-[10px] font-bold text-red-500 uppercase tracking-widest sticky top-0 z-[60] backdrop-blur-sm">
          ⚠️ Connection Failure - Check Supabase Credentials (连接失败 - 检查 Supabase 凭据)
        </div>
      )}

      {isSaving && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center">
           <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent animate-spin rounded-full mb-4"></div>
           <p className="text-amber-500 font-brand font-bold tracking-widest animate-pulse">SYNCING TO CLOUD... (正在同步至云端...)</p>
        </div>
      )}

      <header className="glass sticky top-0 z-40 px-4 py-6 border-b border-white/10 shadow-2xl">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="cursor-pointer" onClick={() => setView('list')}>
            <h1 className="text-3xl font-brand font-bold tracking-tighter text-white">
              A<span className="text-amber-500">IDENTIFY</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-bold">Industrial Intelligence (工业智能)</p>
          </div>
          <button 
            onClick={() => { setView('recognize'); resetForm(); }}
            className="bg-amber-500 text-black px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-amber-400 transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] active:scale-95"
          >
            AI Sync (AI 同步)
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {view === 'list' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-4xl font-brand font-bold text-white tracking-tight">Vision Inventory (库存视图)</h2>
                <p className="text-zinc-500 text-xs font-mono mt-1 tracking-widest uppercase">{parts.length} Units Mapped (已映射单位)</p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search Part No. (搜索零件号)..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-amber-500 w-64 transition-all"
                  />
                  {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2 text-zinc-500">×</button>}
                </div>
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
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9z" clipRule="evenodd" /></svg>
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 19l-7-7 7-7" strokeWidth="2"/></svg>
              </button>
              <h2 className="text-3xl font-brand font-bold">Deep Scan (深度扫描)</h2>
            </div>
            
            {!currentCapture ? (
               <div onClick={() => setIsCameraOpen(true)} className="w-full aspect-video rounded-3xl glass border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-amber-500/50 hover:bg-white/5 transition-all group">
                  <div className="w-20 h-20 glass border border-white/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  </div>
                  <p className="text-xl font-bold text-white mb-2">Start Pro Scanner (开始专业扫描)</p>
               </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <img src={currentCapture} className="rounded-3xl border border-white/10 shadow-2xl w-full aspect-square object-cover" />
                  <button onClick={() => { setCurrentCapture(null); setAnalysisResult(null); setIsCameraOpen(true); }} className="w-full py-4 glass border border-white/10 text-zinc-400 font-bold uppercase text-xs tracking-widest rounded-2xl">Capture Again (再次拍摄)</button>
                </div>
                <div className="space-y-6">
                   {isAnalyzing ? (
                     <div className="glass p-12 rounded-3xl text-center space-y-4 h-full flex flex-col justify-center">
                        <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent animate-spin rounded-full mx-auto mb-4"></div>
                        <p className="text-amber-500 font-brand font-bold animate-pulse text-lg">AI PROCESSING (AI 正在处理)...</p>
                     </div>
                   ) : (
                     <div className="space-y-6">
                        {analysisResult && (
                          <>
                            <div className="glass p-6 rounded-2xl border-l-4 border-amber-500">
                              <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">AI Diagnosis (AI 诊断)</h4>
                              <p className="text-sm text-zinc-300 leading-relaxed font-medium">{analysisResult.detectedFeatures}</p>
                            </div>
                            <div className="space-y-4">
                              <h4 className="text-xs font-bold text-white uppercase tracking-widest border-b border-white/10 pb-2">Matches (匹配项)</h4>
                              <div className="grid gap-4">
                                {analysisResult.matches.map(m => {
                                  const part = parts.find(p => p.id === m.id);
                                  if (!part) return null;
                                  return <PartCard key={m.id} part={part} similarity={m.score} reason={m.reason} isHighConfidence={m.score >= 70} />;
                                })}
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
                <h3 className="font-brand font-bold text-white text-sm tracking-widest uppercase">Expert Agent (专家座席)</h3>
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
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask about records... (询问记录...)" className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm outline-none focus:border-amber-500 transition-colors" />
                <button onClick={handleSendMessage} className="bg-amber-500 text-black px-5 rounded-2xl font-bold">SEND (发送)</button>
              </div>
            </div>

            <div className="flex flex-col glass rounded-3xl border border-white/10 items-center justify-center p-10 space-y-8 text-center shadow-2xl">
               <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center ${isLiveActive ? 'border-amber-500 animate-pulse bg-amber-500/10' : 'border-zinc-800'}`}>
                 <svg className={`h-12 w-12 ${isLiveActive ? 'text-amber-500' : 'text-zinc-700'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v1a7 7 0 01-14 0v-1" strokeWidth="2"/></svg>
               </div>
               <button onClick={toggleLiveAudio} className={`w-full py-5 rounded-2xl font-bold uppercase tracking-widest text-[10px] ${isLiveActive ? 'bg-red-500/20 text-red-500' : 'bg-amber-500 text-black'}`}>
                 {isLiveActive ? 'STOP LIVE (停止通话)' : 'VOICE ASSISTANT (语音助手)'}
               </button>
            </div>
          </div>
        )}

        {view === 'add' && (
          <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
            {!editingPartId && (
              <div className="glass p-8 rounded-[40px] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
                <div>
                  <h3 className="text-xl font-brand font-bold uppercase">XLSX Import (批量导入)</h3>
                  <p className="text-xs text-zinc-500">Import bulk data (导入批量数据)</p>
                </div>
                <label className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest cursor-pointer hover:bg-white/10 transition-all">
                  Select XLSX (选择 XLSX)
                  <input type="file" accept=".xlsx" className="hidden" onChange={handleXlsxUpload} />
                </label>
              </div>
            )}

            <form onSubmit={handleSubmit} className="glass p-10 rounded-[40px] border border-white/10 space-y-10 shadow-3xl">
              <div className="border-b border-white/5 pb-4">
                <h2 className="text-3xl font-brand font-bold tracking-tighter uppercase">{editingPartId ? 'Edit Asset (编辑资产)' : 'New Asset (新资产)'}</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                 <div className="space-y-6">
                   <label className="text-[10px] font-bold text-amber-500 uppercase tracking-widest block mb-2">Image Pool (图片池)</label>
                   <div className="grid grid-cols-2 gap-3">
                     {capturedAngles.map((img, idx) => (
                       <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border border-white/10 group">
                         <img src={img} className="w-full h-full object-cover" />
                         <button type="button" onClick={() => setCapturedAngles(prev => prev.filter((_, i) => i !== idx))} className="absolute inset-0 bg-red-900/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">×</button>
                       </div>
                     ))}
                     {capturedAngles.length < 6 && (
                       <button type="button" onClick={() => setIsCameraOpen(true)} className="aspect-square glass border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-white/5 transition-all">
                         <svg className="h-8 w-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth="1.5"/></svg>
                         <span className="text-[8px] font-bold uppercase text-zinc-500">Capture (拍摄)</span>
                       </button>
                     )}
                   </div>
                 </div>

                 <div className="space-y-5">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Part Number (零件编号)</label>
                      <input required className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.partNumber} onChange={e => setForm({...form, partNumber: e.target.value})} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Technical Name (技术名称)</label>
                      <input required className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.partName} onChange={e => setForm({...form, partName: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block">Compatible Models (车型 - 可多选)</label>
                      <div className="grid grid-cols-2 gap-2">
                         {Object.values(PartModel).map(m => (
                           <button key={m} type="button" onClick={() => toggleModel(m)} className={`px-3 py-2 rounded-xl text-[9px] font-bold transition-all border ${form.models.includes(m) ? 'bg-amber-500 text-black border-amber-500' : 'bg-white/5 text-zinc-400 border-white/10'}`}>{m}</button>
                         ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Color (颜色)</label>
                      <select className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.color} onChange={e => setForm({...form, color: e.target.value as PartColor})}>
                        {Object.values(PartColor).map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Workstation (工位)</label>
                      <input required className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-sm" value={form.workstation} onChange={e => setForm({...form, workstation: e.target.value})} />
                    </div>
                 </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => resetForm()} className="flex-1 py-4 glass text-zinc-500 font-bold uppercase text-[10px] tracking-widest rounded-2xl hover:text-white transition-colors">DISCARD (放弃)</button>
                <button type="submit" disabled={isSaving} className="flex-[2] py-4 bg-amber-500 text-black font-bold uppercase text-[10px] tracking-widest rounded-2xl shadow-xl hover:bg-amber-400 transition-all">
                  {editingPartId ? 'SYNC UPDATE (同步更新)' : 'SAVE RECORD (保存记录)'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      <nav className="fixed bottom-8 inset-x-0 mx-auto max-w-md glass rounded-[32px] px-8 py-5 flex justify-between items-center z-40 border border-white/10 shadow-2xl">
        <button onClick={() => setView('list')} className={`flex flex-col items-center gap-1 transition-all ${view === 'list' ? 'text-amber-500 scale-110' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Base</span>
        </button>
        <button onClick={() => { setView('recognize'); resetForm(); }} className="bg-amber-500 text-black w-16 h-16 -mt-16 rounded-[22px] flex items-center justify-center shadow-2xl border-4 border-black/80">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </button>
        <button onClick={() => setView('assistant')} className={`flex flex-col items-center gap-1 transition-all ${view === 'assistant' ? 'text-amber-500 scale-110' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Expert</span>
        </button>
        <button onClick={() => { setView('add'); resetForm(); }} className={`flex flex-col items-center gap-1 transition-all ${view === 'add' ? 'text-amber-500 scale-110' : 'text-zinc-600'}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14m-7-7h14"/></svg>
          <span className="text-[8px] font-bold uppercase tracking-widest">Add</span>
        </button>
      </nav>

      {isCameraOpen && <CameraCapture onCapture={handleCapture} onCancel={() => { setIsCameraOpen(false); setTargetPartIdForPhoto(null); }} />}
    </div>
  );
};

export default App;
