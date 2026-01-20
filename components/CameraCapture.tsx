
import React, { useRef, useState, useCallback, useEffect } from 'react';

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  onCancel: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setError("Não foi possível acessar a câmera. Verifique as permissões.");
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(dataUrl);
        stream?.getTracks().forEach(track => track.stop());
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4">
      {error ? (
        <div className="text-white text-center">
          <p className="mb-4">{error}</p>
          <button onClick={onCancel} className="bg-white text-black px-6 py-2 rounded-full font-bold">Voltar</button>
        </div>
      ) : (
        <>
          <div className="relative w-full max-w-lg aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-900 border-2 border-zinc-700">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 pointer-events-none border-[40px] border-black/20 flex items-center justify-center">
               <div className="w-64 h-64 border-2 border-white/50 border-dashed rounded-lg"></div>
            </div>
          </div>
          
          <div className="flex gap-8 mt-8 items-center">
            <button 
              onClick={onCancel}
              className="w-14 h-14 flex items-center justify-center rounded-full bg-white/10 text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <button
              onClick={handleCapture}
              className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-zinc-400 active:scale-90 transition-transform"
            >
              <div className="w-16 h-16 bg-white rounded-full border-2 border-zinc-900 shadow-lg"></div>
            </button>
            
            <div className="w-14 h-14" />
          </div>
          <p className="text-white/60 mt-4 text-sm">Posicione a peça dentro do quadro</p>
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default CameraCapture;
