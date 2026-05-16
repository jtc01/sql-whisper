"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface VoiceControlsProps {
  onQueryComplete?: () => void;
  showKeyboard?: boolean;
}

export function VoiceControls({ onQueryComplete, showKeyboard = false }: VoiceControlsProps) {
  const [isListening, setIsListening] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  
  const activeInteractionRef = React.useRef<"keyboard" | "mouse" | null>(null);
  const isProcessingRef = React.useRef(false);
  const modeRef = React.useRef(mode);

  React.useEffect(() => {
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isProcessing, mode]);

  const startListening = React.useCallback((source: "keyboard" | "mouse") => {
    if (isProcessingRef.current || activeInteractionRef.current) return;
    activeInteractionRef.current = source;
    setIsListening(true);
  }, []);

  const stopListening = React.useCallback((source: "keyboard" | "mouse") => {
    if (activeInteractionRef.current !== source) return;
    activeInteractionRef.current = null;
    setIsListening(false);
    setIsProcessing(true);
    
    setTimeout(() => {
      setIsProcessing(false);
      onQueryComplete?.();
    }, 2000);
  }, [onQueryComplete]);

  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textQuery.trim() || isProcessing) return;
    
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setTextQuery("");
      setMode("voice");
      onQueryComplete?.();
    }, 1500);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (modeRef.current === "voice") startListening("keyboard");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (modeRef.current === "voice") stopListening("keyboard");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startListening, stopListening]);

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-6 z-50 w-full max-w-xl px-4">
      {/* 1. Status Layer - Fixed height to avoid shifts */}
      <div className="h-10 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {isProcessing ? (
            <motion.div 
              key="processing"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="flex items-center gap-4 h-9 px-6 rounded-full border border-border bg-card/50 backdrop-blur-xl shadow-lg !transition-none"
            >
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="text-[10px] font-mono text-primary font-bold uppercase tracking-widest">Decrypting Registry</span>
            </motion.div>
          ) : isListening ? (
            <motion.div 
              key="listening"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="flex items-center gap-2 h-9 px-6 rounded-full border border-border bg-card/50 backdrop-blur-xl shadow-lg !transition-none"
            >
              <div className="flex items-center gap-1 h-3.5">
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [4, 10, 6] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                    className="w-1 bg-primary rounded-full"
                  />
                ))}
                <span className="ml-3 text-[10px] font-mono text-primary font-bold uppercase tracking-widest">Uplink Active</span>
              </div>
            </motion.div>
          ) : !isListening && !isProcessing && mode === "voice" ? (
            <motion.div 
              key="standby"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="px-5 py-1.5 rounded-full border border-border bg-card/20 backdrop-blur-md flex items-center gap-3 !transition-none"
            >
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Hold Space to Uplink</span>
              <kbd className="text-[8px] bg-accent px-1.5 py-0.5 rounded border border-border font-bold text-foreground">SPACE</kbd>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* 2. Unified Command Shell */}
      <motion.div 
        layout
        initial={false}
        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 1 }}
        className={cn(
          "relative flex items-center justify-center shadow-2xl border border-border !transition-none",
          mode === "text" 
            ? "w-full h-16 rounded-2xl bg-card px-4" 
            : "w-auto h-20 rounded-full bg-transparent border-transparent shadow-none gap-6"
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === "voice" ? (
            <React.Fragment key="voice-group">
              {showKeyboard && !isListening && !isProcessing && (
                <motion.button
                  key="kb-btn"
                  layout
                  initial={{ opacity: 0, scale: 0.5, x: 20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.5, x: 20 }}
                  onClick={() => setMode("text")}
                  className="w-20 h-20 rounded-full border border-border bg-card/30 backdrop-blur-md flex items-center justify-center text-muted-foreground hover:text-foreground shadow-lg shrink-0 !transition-none"
                >
                  <Keyboard className="w-8 h-8" />
                </motion.button>
              )}

              <motion.button
                key="mic-btn"
                layout
                onMouseDown={() => startListening("mouse")}
                onMouseUp={() => stopListening("mouse")}
                onMouseLeave={() => stopListening("mouse")}
                disabled={isProcessing}
                className={cn(
                  "relative flex items-center justify-center w-20 h-20 rounded-full shadow-2xl shrink-0 !transition-none duration-300",
                  isListening ? "bg-rose-600 shadow-rose-900/40" : "bg-primary hover:bg-primary/90 shadow-primary/10"
                )}
              >
                <motion.div layout className="relative z-20">
                  <AnimatePresence mode="wait">
                    {isListening ? (
                      <motion.div key="sq" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
                        <Square className="w-7 h-7 text-white fill-white" />
                      </motion.div>
                    ) : (
                      <motion.div key="mic" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
                        <Mic className="w-8 h-8 text-primary-foreground" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
                
                <AnimatePresence>
                  {isListening && (
                    <motion.div
                      key="pulse-rings"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-0 pointer-events-none"
                    >
                      <div className="absolute inset-0 rounded-full bg-rose-500 animate-mic-pulse opacity-40" />
                      <div className="absolute inset-0 rounded-full bg-rose-400 animate-mic-pulse-delayed opacity-20" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </React.Fragment>
          ) : (
            <motion.form 
              key="text-form"
              layout
              onSubmit={handleTextSubmit}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center w-full h-full gap-2 !transition-none"
            >
              <input
                autoFocus
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="MANUAL VECTOR ENTRY..."
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-mono text-sm uppercase tracking-tight pl-4"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon" 
                  className="h-10 w-10 text-muted-foreground hover:text-foreground" 
                  onClick={() => setMode("voice")}
                >
                  <X className="w-5 h-5" />
                </Button>
                <Button 
                  type="submit" 
                  disabled={!textQuery.trim()} 
                  className="h-10 w-10 bg-primary text-primary-foreground shadow-lg"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
