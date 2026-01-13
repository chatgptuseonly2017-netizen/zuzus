
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Character } from './types';
import { CHARACTERS } from './constants';
import Header from './components/Header';
import CharacterCard from './components/CharacterCard';
import CharacterDetail from './components/CharacterDetail';

const App: React.FC = () => {
  const [currentSection, setCurrentSection] = useState(0); // 0: Hero, 1: Gallery
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  
  // Carousel Drag State
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Camera Gesture State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    
    // Handle vertical scroll to horizontal transition
    const handleWheel = (e: WheelEvent) => {
      if (selectedCharacter) return;
      
      // If we are on hero and scroll down
      if (currentSection === 0 && e.deltaY > 30) {
        setCurrentSection(1);
      }
      // If we are on gallery and scroll up (and at the start of carousel)
      if (currentSection === 1 && e.deltaY < -30 && activeIndex === 0 && !isDragging) {
        setCurrentSection(0);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [currentSection, selectedCharacter, activeIndex, isDragging]);

  const nextCharacter = useCallback(() => {
    setActiveIndex(prev => (prev + 1) % CHARACTERS.length);
  }, []);

  const prevCharacter = useCallback(() => {
    setActiveIndex(prev => (prev - 1 + CHARACTERS.length) % CHARACTERS.length);
  }, []);

  const handleCardClick = (character: Character, index: number) => {
    if (Math.abs(dragOffset) < 10) {
      if (index === activeIndex) {
        setSelectedCharacter(character);
      } else {
        setActiveIndex(index);
      }
    }
  };

  const onDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (selectedCharacter || currentSection === 0) return;
    setIsDragging(true);
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    setStartX(clientX);
    setDragOffset(0);
  };

  const onDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const offset = clientX - startX;
    setDragOffset(offset);
  };

  const onDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = 50;
    if (dragOffset > threshold) prevCharacter();
    else if (dragOffset < -threshold) nextCharacter();
    setDragOffset(0);
  };

  const cardWidth = windowWidth < 768 ? 280 : 320;
  const gap = windowWidth < 768 ? 20 : 40;
  const stepWidth = cardWidth + gap;
  const startOffset = (windowWidth / 2) - (cardWidth / 2);

  const toggleCameraGestures = async () => {
    if (isCameraActive) {
      setIsCameraActive(false);
      sessionRef.current?.close?.();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
        startGeminiGestureSession();
      }
    } catch (err) {
      alert("Please allow camera access for gestures.");
    }
  };

  const startGeminiGestureSession = async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          const interval = setInterval(() => {
            if (!isCameraActive || !videoRef.current || !canvasRef.current) {
              clearInterval(interval);
              return;
            }
            const ctx = canvasRef.current.getContext('2d');
            if (ctx && videoRef.current.videoWidth > 0) {
              canvasRef.current.width = 320;
              canvasRef.current.height = 240;
              ctx.drawImage(videoRef.current, 0, 0, 320, 240);
              canvasRef.current.toBlob((blob) => {
                if (blob) {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const base64Data = (reader.result as string).split(',')[1];
                    sessionPromise.then(session => {
                      session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
                    });
                  };
                  reader.readAsDataURL(blob);
                }
              }, 'image/jpeg', 0.5);
            }
          }, 1000);
        },
        onmessage: async (message: any) => {
          if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
              if (fc.name === 'next_slide') nextCharacter();
              if (fc.name === 'prev_slide') prevCharacter();
              if (fc.name === 'open_details') setSelectedCharacter(CHARACTERS[activeIndex]);
              sessionPromise.then(s => s.sendToolResponse({
                functionResponses: [{ id: fc.id, name: fc.name, response: { result: "ok" } }]
              }));
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "Detect gestures: LEFT swipe -> 'next_slide', RIGHT swipe -> 'prev_slide', THUMBS UP -> 'open_details'.",
          tools: [{
            functionDeclarations: [
              { name: 'next_slide', parameters: { type: 'OBJECT', properties: {} } },
              { name: 'prev_slide', parameters: { type: 'OBJECT', properties: {} } },
              { name: 'open_details', parameters: { type: 'OBJECT', properties: {} } }
            ]
          }]
        }
      }
    });
    sessionRef.current = await sessionPromise;
  };

  return (
    <div 
      className="w-full h-screen bg-white overflow-hidden relative"
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
      onTouchMove={onDragMove}
      onTouchEnd={onDragEnd}
    >
      {/* Camera Preview Overlay */}
      {!selectedCharacter && isCameraActive && (
        <div className="fixed top-4 right-4 z-[200] w-24 md:w-32 aspect-video rounded-xl overflow-hidden border-2 border-rose-500 bg-black shadow-xl">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale opacity-50" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
          </div>
        </div>
      )}

      {/* Main Horizontal Scroller */}
      <div 
        className="flex w-[200vw] h-full will-change-transform transition-transform duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{ transform: `translateX(-${currentSection * 100}vw)` }}
      >
        {/* PAGE 1: HERO */}
        <section className={`relative w-screen h-full overflow-hidden flex flex-col items-center justify-center text-white transition-all duration-[1200ms] ${currentSection === 1 ? 'scale-95 opacity-0 blur-md' : 'scale-100 opacity-100 blur-0'}`}>
          <video 
            autoPlay 
            loop 
            muted 
            playsInline 
            className="absolute inset-0 w-full h-full object-cover z-0"
          >
            <source src="https://littletigersbooks.com/img/home.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-black/30 z-10"></div>
          
          <div className="relative z-20 flex flex-col items-center gap-4 md:gap-6 text-center px-4 max-w-5xl">
            <img 
              src="https://littletigersbooks.com/img/logo%20(1).png" 
              alt="Logo" 
              className="h-40 md:h-[300px] lg:h-[400px] w-auto object-contain drop-shadow-2xl transition-all duration-700 hover:scale-105"
            />
            <div>
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase drop-shadow-lg mb-2 text-white">Welcome to the Jungle</h1>
              <p className="text-lg md:text-xl font-light tracking-widest opacity-80 uppercase text-white">World of Little Tigers</p>
            </div>
            <button 
              onClick={() => setCurrentSection(1)}
              className="mt-6 px-12 py-5 bg-white text-black font-black uppercase tracking-[0.2em] rounded-full hover:scale-110 active:scale-95 transition-all shadow-2xl"
            >
              Explore Characters
            </button>
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 opacity-60 animate-bounce">
            <div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-white to-transparent"></div>
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase">Scroll</span>
          </div>
        </section>

        {/* PAGE 2: GALLERY */}
        <section className={`relative w-screen h-full flex flex-col bg-white transition-all duration-[1200ms] delay-100 ${currentSection === 0 ? 'translate-x-32 opacity-0' : 'translate-x-0 opacity-100'}`}>
          {/* Faded Background Image */}
          <div 
            className="absolute inset-0 z-0 opacity-50 pointer-events-none bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: 'url("https://littletigersbooks.com/img/charactor.jpg")' }}
          ></div>

          <Header />
          
          {/* Back to Hero Button (Top Left) */}
          <button 
            onClick={() => setCurrentSection(0)}
            className="absolute top-8 left-8 z-50 p-2 hover:bg-gray-100 rounded-full transition-all group"
          >
            <svg className="w-6 h-6 rotate-180 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7-7 7M3 12h18" />
            </svg>
          </button>

          <main 
            className={`flex-1 w-full flex flex-col justify-center relative z-10 transition-all duration-700 pb-12 ${selectedCharacter ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100 scale-100'}`}
          >
            <div 
              className="relative w-full overflow-visible touch-none select-none cursor-grab active:cursor-grabbing pb-12"
              onMouseDown={onDragStart}
              onTouchStart={onDragStart}
            >
              <div 
                ref={carouselRef}
                className={`flex items-end will-change-transform ${isDragging ? 'transition-none' : 'transition-transform duration-[800ms] ease-[cubic-bezier(0.2,1,0.2,1)]'}`}
                style={{ 
                  transform: `translateX(${startOffset - (activeIndex * stepWidth) + dragOffset}px)`,
                }}
              >
                {CHARACTERS.map((char, index) => (
                  <div 
                    key={char.id} 
                    className="pointer-events-none"
                    style={{ minWidth: `${cardWidth}px`, marginRight: `${gap}px` }}
                  >
                    <div className="pointer-events-auto">
                      <CharacterCard 
                        character={char} 
                        isActive={activeIndex === index}
                        onClick={(c) => handleCardClick(c, index)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gallery Controls */}
            <div className="px-6 md:px-12 flex flex-col md:flex-row justify-between items-center gap-6 mt-4">
              <div className="flex gap-8 items-center text-gray-400">
                <button onClick={toggleCameraGestures} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all border ${isCameraActive ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-100 shadow-sm'}`}>
                  <span className="text-xl">{isCameraActive ? '✨' : '👋'}</span>
                </button>
                <div className="flex gap-6 text-[10px] font-black uppercase tracking-[0.2em]">
                  <a href="#" className="hover:text-black">Social</a>
                  <a href="#" className="hover:text-black">About</a>
                </div>
              </div>

              <div className="flex gap-8 items-center select-none">
                <button 
                  onClick={prevCharacter}
                  className="group flex items-center gap-3 hover:text-black transition-all font-black uppercase text-[12px] tracking-widest text-gray-900"
                >
                  <div className="w-10 h-10 rounded-full border border-gray-100 flex items-center justify-center group-hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
                  </div>
                  Prev
                </button>
                <div className="h-1 w-12 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-black transition-all duration-500" 
                      style={{ width: `${((activeIndex + 1) / CHARACTERS.length) * 100}%` }}
                    />
                </div>
                <button 
                  onClick={nextCharacter}
                  className="group flex items-center gap-3 hover:text-black transition-all font-black uppercase text-[12px] tracking-widest text-gray-900"
                >
                  Next
                  <div className="w-10 h-10 rounded-full border border-gray-100 flex items-center justify-center group-hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                  </div>
                </button>
              </div>
            </div>
          </main>
        </section>
      </div>

      {selectedCharacter && (
        <CharacterDetail 
          character={selectedCharacter} 
          onBack={() => setSelectedCharacter(null)} 
        />
      )}
    </div>
  );
};

export default App;
