"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { apiService } from "@/lib/api-service";
import { type QueryResult, type ConversationMessage } from "@/app/page";

export type RecordingStatus = "idle" | "starting" | "recording" | "stopping" | "processing" | "error";

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

interface UseMicrophoneOptions {
  onStart?: () => void;
  onSuccess?: (result: QueryResult) => void;
  onError?: () => void;
  activeConnectionId?: string;
  conversationHistory?: ConversationMessage[];
}

export function useMicrophone({ onStart, onSuccess, onError, activeConnectionId, conversationHistory = [] }: UseMicrophoneOptions) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const [trtcModule, setTrtcModule] = useState<TRTCModule | null>(null);
  const trtcRef = useRef<TRTCClient | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string | null>(null);
  const isStoppingRef = useRef(false);

  // Dynamic import of TRTC to prevent SSR errors
  useEffect(() => {
    if (typeof window !== "undefined") {
      const loadTRTC = async () => {
        try {
          const sdk = await import("trtc-sdk-v5");
          setTrtcModule(() => sdk.default as unknown as TRTCModule);
          console.log("[TRTC] SDK loaded");
        } catch (err) {
          console.error("[TRTC] SDK load failed:", err);
        }
      };
      loadTRTC();
    }
  }, []);

  // Keep a ref to conversationHistory so it's accessible in the TRTC callback
  const historyRef = useRef<ConversationMessage[]>(conversationHistory);
  useEffect(() => {
    historyRef.current = conversationHistory;
  }, [conversationHistory]);

  const handleAsk = useCallback(async (question: string) => {
    if (!activeConnectionId || !question.trim()) return;

    setStatus("processing");
    onStart?.();

    try {
      // Use current conversation history for follow-up context
      const history = historyRef.current;
      const isFollowUp = history.length > 0;

      const response = await apiService.ask(activeConnectionId, question, history);
      // Transform backend response to match QueryResult interface
      const result: QueryResult = {
        id: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        connection_id: activeConnectionId,
        text: response.text || question,
        answer: response.answer,
        sql: response.sql,
        created_at: new Date().toISOString(),
        data: response.data || [],
        stats: response.stats || [],
        chartSpec: response.chartSpec,
        messages: response.messages || [],
        isFollowUp, // Flag to indicate this was a follow-up query
      };
      onSuccess?.(result);
      setStatus("idle");
    } catch (err) {
      console.error("[TRTC] Query failed:", err);
      setError("Query Failed");
      onError?.();
      setStatus("error");
      setTimeout(() => {
        setError(null);
        setStatus("idle");
      }, 3000);
    }
  }, [activeConnectionId, onStart, onSuccess, onError]);

  const handleAskRef = useRef(handleAsk);
  useEffect(() => {
    handleAskRef.current = handleAsk;
  }, [handleAsk]);

  const stopRecording = useCallback(async () => {
    if (status !== "recording" || isStoppingRef.current) return;

    isStoppingRef.current = true;
    setStatus("stopping");

    // Wait for any final transcript messages
    await new Promise(resolve => setTimeout(resolve, 500));

    const pendingTranscript = lastTranscriptRef.current;
    lastTranscriptRef.current = null;

    try {
      if (taskIdRef.current) {
        await apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        await trtcRef.current.stopLocalAudio().catch(() => {});
        await trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null;
      }

      // Submit the captured transcript
      if (pendingTranscript) {
        console.log(`[TRTC] Submitting transcript: "${pendingTranscript}"`);
        handleAskRef.current(pendingTranscript);
      } else {
        setStatus("idle");
      }
    } catch (err) {
      console.error("[TRTC] Stop error:", err);
      setStatus("idle");
    } finally {
      isStoppingRef.current = false;
    }
  }, [status]);

  const startRecording = useCallback(async () => {
    if (!activeConnectionId) {
      setError("No active connection");
      setStatus("error");
      setTimeout(() => {
        setError(null);
        setStatus("idle");
      }, 3000);
      return;
    }

    if (status !== "idle" && status !== "error") {
      return;
    }

    if (!trtcModule) {
      setError("Voice not ready");
      setStatus("error");
      setTimeout(() => {
        setError(null);
        setStatus("idle");
      }, 3000);
      return;
    }

    setStatus("starting");
    setError(null);
    lastTranscriptRef.current = null;

    try {
      // Create TRTC client if needed
      if (!trtcRef.current) {
        trtcRef.current = trtcModule.create();
        trtcRef.current.on(trtcModule.EVENT.CUSTOM_MESSAGE, (event: { data: ArrayBuffer }) => {
          try {
            const decoded = new TextDecoder().decode(event.data);
            const msg = JSON.parse(decoded);
            if (msg.type === 10000 && msg.payload?.text) {
              lastTranscriptRef.current = msg.payload.text;
              console.log(`[TRTC] Transcript: "${msg.payload.text}" (end: ${msg.payload.end})`);

              // If ASR signals end of sentence, submit immediately
              if (msg.payload.end === true) {
                lastTranscriptRef.current = null;
                handleAskRef.current(msg.payload.text);
              }
            }
          } catch (e) {
            console.warn("[TRTC] Parse error:", e);
          }
        });
      }

      // Get TRTC credentials
      const { user_sig, sdk_app_id, user_id } = await apiService.getTRTCUserSig();
      const sdkAppId = Number(sdk_app_id);

      if (!sdkAppId || sdkAppId === 0) {
        throw new Error("Invalid SDK App ID");
      }

      const roomId = Math.floor(Math.random() * 1_000_000_000);

      // Enter room and start audio
      await trtcRef.current.enterRoom({ sdkAppId, userId: user_id, userSig: user_sig, roomId });
      await trtcRef.current.startLocalAudio();

      // Start transcription
      const { task_id } = await apiService.startTranscription(roomId);
      taskIdRef.current = task_id;

      setStatus("recording");
      console.log("[TRTC] Recording started");

    } catch (err) {
      console.error("[TRTC] Start error:", err);
      setError("Voice Error");
      setStatus("error");

      // Cleanup on error
      if (taskIdRef.current) {
        apiService.stopTranscription(taskIdRef.current).catch(() => {});
        taskIdRef.current = null;
      }
      if (trtcRef.current) {
        trtcRef.current.stopLocalAudio().catch(() => {});
        trtcRef.current.exitRoom().catch(() => {});
        trtcRef.current = null;
      }

      setTimeout(() => {
        setError(null);
        setStatus("idle");
      }, 3000);
    }
  }, [activeConnectionId, status, trtcModule]);

  return {
    status,
    error,
    startRecording,
    stopRecording,
  };
}
