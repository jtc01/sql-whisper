"use client";

import { useState, useCallback, useRef } from "react";
import { apiService } from "@/lib/api-service";

export type RecordingStatus = "idle" | "starting" | "recording" | "stopping" | "processing" | "error";

interface UseMicrophoneOptions {
  onStart?: () => void;
  onSuccess?: (result: any) => void;
  onError?: () => void;
  activeConnectionId?: string;
}

export function useMicrophone({ onStart, onSuccess, onError, activeConnectionId }: UseMicrophoneOptions) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    if (!activeConnectionId) {
      setError("No active database connection");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
      return;
    }

    try {
      setStatus("starting");
      setError(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        stream.getTracks().forEach(track => track.stop());
        
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setStatus("recording");
    } catch (err: any) {
      console.error("Microphone access failed:", err);
      setError("Microphone access denied");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }, [activeConnectionId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "recording") {
      setStatus("stopping");
      mediaRecorderRef.current.stop();
    }
  }, [status]);

  const processAudio = async (blob: Blob) => {
    setStatus("processing");
    try {
      const formData = new FormData();
      formData.append("audio", blob);
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://earphone-opossum-settling.ngrok-free.dev"}/transcribe`, {
        method: "POST",
        headers: {
          "X-Connection-Id": activeConnectionId!,
          "ngrok-skip-browser-warning": "true",
        },
        body: formData,
      });

      if (!response.ok) throw new Error("Transcription failed");
      
      const { text } = await response.json();
      
      onStart?.(); 
      const result = await apiService.ask(activeConnectionId!, text);
      onSuccess?.(result);
      setStatus("idle");
    } catch (err: any) {
      console.error("Audio processing failed:", err);
      setError("Failed to process audio");
      onError?.();
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return {
    status,
    error,
    startRecording,
    stopRecording,
  };
}