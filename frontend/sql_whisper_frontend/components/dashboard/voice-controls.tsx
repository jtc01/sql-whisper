"use client";

import * as React from "react";
import { Mic, Square, Loader2, Keyboard, Send, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { apiService } from "@/lib/api-service";
import { type QueryResult } from "@/app/page";

interface TRTCClient {
  on: (event: string, callback: (event: { data: ArrayBuffer }) => void) => void;
  enterRoom: (options: { sdkAppId: number; userId: string; userSig: string; roomId: number }) => Promise<void>;
  startLocalAudio: () => Promise<void>;
  stopLocalAudio: () => Promise<void>;
  exitRoom: () => Promise<void>;
}

interface TRTCModule {
  create: () => TRTCClient;
  EVENT: {
    CUSTOM_MESSAGE: string;
  };
}

interface VoiceControlsProps {
  onQueryComplete?: (result: QueryResult) => void;
  showKeyboard?: boolean;
  activeConnectionId?: string;
}

export function VoiceControls({ onQueryComplete, showKeyboard = false, activeConnectionId }: VoiceControlsProps) {
  const [isListening, setIsListening] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [mode, setMode] = React.useState<"voice" | "text">("voice");
  const [textQuery, setTextQuery] = React.useState("");
  
  const [trtcModule, setTrtcModule] = React.useState<TRTCModule | null>(null);
  const trtcRef = React.useRef<TRTCClient | null>(null);
  const taskIdRef = React.useRef<string | null>(null);

  // Dynamic import of TRTC to prevent SSR errors (location is not defined)
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const loadTRTC = async () => {
        console.log("[Uplink] Fetching TRTC SDK package...");
        try {
          const sdk = await import("trtc-sdk-v5");
          setTrtcModule(() => sdk.default as unknown as TRTCModule);
          console.log("[Uplink] TRTC SDK Package Online.");
        } catch (err) {
          console.error("[Uplink] TRTC SDK Payload Failure:", err);
        }
      };
      loadTRTC();
    }
  }, []);
  
  const activeInteractionRef = React.useRef<"keyboard" | "mouse" | null>(null);
  const isInitializingRef = React.useRef(false);
  const isStoppingRef = React.useRef(false);
  const isProcessingRef = React.useRef(false);
  const modeRef = React.useRef(mode);

  React.useEffect(() => {
    isProcessingRef.current = isProcessing;
    modeRef.current = mode;
  }, [isProcessing, mode]);

  const handleAsk = React.useCallback(async (question: string) => {
    if (!activeConnectionId) return;
    setIsProcessing(true);
    try {
      const result = await apiService.ask(activeConnectionId, question);
      onQueryComplete?.(result);
    } catch (error) {
      console.error("Vector Query Failed:", error);
    } finally {
      setIsProcessing(false);
      setTextQuery("");
      setMode("voice");
    }
  }, [activeConnectionId, onQueryComplete]);

  // Use a ref for handleAsk to avoid stale closures in TRTC events
  const handleAskRef = React.useRef(handleAsk);
  React.useEffect(() => {
    handleAskRef.current = handleAsk;
  }, [handleAsk]);

  const stopListening = React.useCallback(async (source: "keyboard" | "mouse") => {
    if (activeInteractionRef.current !== source || isStoppingRef.current) return;

    isStoppingRef.current = true;
    console.log(`[Uplink] Terminating session from ${source}...`);
    try {
      if (taskIdRef.current) {
        await apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        await trtcRef.current.stopLocalAudio().catch(() => {});
        await trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null; // Clear the client so a fresh one is created next time
      }
    } catch (error) {
      console.error("[Uplink] Termination Error:", error);
    } finally {
      activeInteractionRef.current = null;
      isStoppingRef.current = false;
      setIsListening(false);
    }
  }, []);

  const startListening = React.useCallback(async (source: "keyboard" | "mouse") => {
    console.log(`[Uplink] Activation attempt from ${source}. ConnID: ${activeConnectionId}`);
    
    if (isProcessingRef.current || activeInteractionRef.current || isInitializingRef.current) {
      console.warn("[Uplink] Activation blocked: busy or already initializing.");
      return;
    }
    
    if (!activeConnectionId) {
      console.error("[Uplink] Activation failed: No active connection ID.");
      return;
    }
    
    isInitializingRef.current = true;
    try {
      activeInteractionRef.current = source;
      setIsListening(true);

      // TRTC Flow
      if (!trtcModule) {
        throw new Error("TRTC SDK not initialized");
      }

      if (!trtcRef.current) {
        console.log("[Uplink] Initializing TRTC Instance...");
        trtcRef.current = trtcModule.create();
        trtcRef.current.on(trtcModule.EVENT.CUSTOM_MESSAGE, (event: { data: ArrayBuffer }) => {
          try {
            const decoded = new TextDecoder().decode(event.data);
            console.log("[Uplink] CUSTOM_MESSAGE raw:", decoded);
            const msg = JSON.parse(decoded);
            console.log("[Uplink] CUSTOM_MESSAGE parsed:", msg);
            if (msg.type === 10000) {
              console.log("[Uplink] ASR message - end:", msg.payload?.end, "text:", msg.payload?.text);
              if (msg.payload?.end === true && msg.payload?.text) {
                const transcript = msg.payload.text;
                console.log(`[Uplink] Final Transcript: "${transcript}"`);
                handleAskRef.current(transcript);
              }
            }
          } catch (e) {
            console.warn("[Uplink] Could not parse CUSTOM_MESSAGE:", e);
          }
        });
      }

      console.log("[Uplink] Requesting UserSig...");
      const response = await apiService.getTRTCUserSig();
      console.log("[Uplink] UserSig response:", response);

      const { user_sig, sdk_app_id, user_id } = response;
      const sdkAppId = Number(sdk_app_id);

      if (!sdkAppId || sdkAppId === 0) {
        throw new Error(`Invalid sdk_app_id received: ${sdk_app_id}`);
      }

      // Room ID must be positive integer ≤ 2^31 (2147483647)
      const roomId = Math.floor(Math.random() * 1_000_000_000);

      console.log(`[Uplink] Entering Room ${roomId} as ${user_id} with sdkAppId ${sdkAppId}...`);
      await trtcRef.current.enterRoom({ sdkAppId, userId: user_id, userSig: user_sig, roomId });

      console.log("[Uplink] Opening Local Audio...");
      await trtcRef.current.startLocalAudio();

      console.log("[Uplink] Starting Remote Transcription...");
      const { task_id } = await apiService.startTranscription(roomId);
      taskIdRef.current = task_id;
      console.log("[Uplink] Signal Stable.");

    } catch (error) {
      console.error("[Uplink] Hardware/Network Interference:", error);
      // Clean up on failure
      if (taskIdRef.current) {
        apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        trtcRef.current.stopLocalAudio().catch(() => {});
        trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null; // Clear so fresh client is created next time
      }
      activeInteractionRef.current = null;
      setIsListening(false);
    } finally {
      isInitializingRef.current = false;
    }
  }, [activeConnectionId, trtcModule]);

  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!textQuery.trim() || isProcessing) return;
    handleAsk(textQuery);
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
        if (modeRef.current === "voice") {
          stopListening("keyboard");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startListening, stopListening]);

  const spring = { type: "spring" as const, stiffness: 450, damping: 40, mass: 1 };

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50 flex flex-col items-center gap-6">
      {/* 1. Boxed Status Telemetry */}
      <div className="h-10 flex items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {(isListening || isProcessing || mode === "voice") && (
            <motion.div 
              key="status-box"
              initial={{ opacity: 0, scale: 0.95, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              className="px-4 py-1.5 rounded-lg border border-border bg-card/50 backdrop-blur-xl shadow-lg flex items-center gap-3 min-w-[180px] justify-center"
            >
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    <span className="text-[10px] font-mono text-primary font-bold uppercase tracking-wider">Processing</span>
                  </motion.div>
                ) : isListening ? (
                  <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                    <div className="flex items-center gap-0.5 h-3 mx-0.5">
                      {[...Array(4)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, 10, 4] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                          className="w-0.5 bg-rose-500/50 rounded-full"
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-rose-500 font-bold uppercase tracking-wider">Uplink Active</span>
                  </motion.div>
                ) : (
                  <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Ready to Uplink</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2. Atomic Command Surface */}
      <motion.div
        layout
        transition={spring}
        className={cn(
          "relative flex items-center justify-center overflow-hidden !transition-none",
          mode === "text" 
            ? "w-full h-16 rounded-2xl bg-card border border-border shadow-2xl" 
            : "w-auto h-24 rounded-full bg-card/20 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] px-2"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "voice" ? (
            <motion.div 
              key="v-ui"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
              className="flex items-center gap-4 px-2"
            >
              <AnimatePresence mode="popLayout">
                {showKeyboard && !isListening && !isProcessing && (
                  <motion.button
                    layout
                    key="kb"
                    disabled={!activeConnectionId}
                    initial={{ opacity: 0, scale: 0, x: 20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0, x: 40 }}
                    transition={spring}
                    onClick={() => setMode("text")}
                    className={cn(
                      "w-20 h-20 rounded-full border border-border bg-card/30 backdrop-blur-xl flex items-center justify-center text-muted-foreground hover:text-foreground shadow-lg shrink-0 !transition-none",
                      !activeConnectionId && "opacity-20 cursor-not-allowed"
                    )}
                  >
                    <Keyboard className="w-8 h-8" />
                  </motion.button>
                )}
              </AnimatePresence>

              <motion.button
                layout
                onMouseDown={() => startListening("mouse")}
                onMouseUp={() => stopListening("mouse")}
                onMouseLeave={() => stopListening("mouse")}
                disabled={isProcessing || !activeConnectionId}
                transition={spring}
                className={cn(
                  "relative flex items-center justify-center w-20 h-20 rounded-full shrink-0 overflow-hidden !transition-none",
                  isListening ? "bg-rose-600 shadow-inner" : "bg-primary",
                  !activeConnectionId && "opacity-20 cursor-not-allowed grayscale"
                )}
              >
                <div className="relative z-20">
                  <AnimatePresence mode="wait">
                    {isListening ? (
                      <motion.div key="sq" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.1 }}>
                        <Square className="w-7 h-7 text-white fill-white" />
                      </motion.div>
                    ) : (
                      <motion.div key="mi" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.1 }}>
                        <Mic className="w-8 h-8 text-primary-foreground" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {isListening && (
                  <div className="absolute inset-0 z-0">
                    <div className="absolute inset-0 rounded-full bg-rose-500 animate-mic-pulse opacity-40" />
                    <div className="absolute inset-0 rounded-full bg-rose-400 animate-mic-pulse-delayed opacity-20" />
                  </div>
                )}
              </motion.button>
            </motion.div>
          ) : (
            <motion.form 
              key="t-ui"
              onSubmit={handleTextSubmit}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0, transition: { delay: 0.15 } }}
              exit={{ opacity: 0, x: 10, transition: { duration: 0.1 } }}
              className="flex-1 flex items-center h-full px-4 gap-4 !transition-none"
            >
              <input
                autoFocus
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="MANUAL VECTOR ENTRY..."
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-mono text-sm uppercase tracking-tight"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon" 
                  className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-xl" 
                  onClick={() => setMode("voice")}
                >
                  <X className="w-5 h-5" />
                </Button>
                <Button 
                  type="submit" 
                  disabled={!textQuery.trim()} 
                  className="h-10 w-10 bg-primary text-primary-foreground shadow-lg rounded-xl"
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
