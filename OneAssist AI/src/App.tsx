import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  Square,
  Sparkles,
  Search,
  BookOpen,
  Coins,
  Pill,
  RefreshCw,
  Clock,
  Settings2,
  Keyboard,
  Compass,
  AlertTriangle,
  FileText,
  ScanQrCode,
  CheckCircle,
  Pause,
  Sliders,
  ChevronRight,
  Upload,
  Trash2,
  Image as ImageIcon
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DetectedObject, AnalysisResult, HistoryItem } from "./types";

export default function App() {
  // --- Navigation & States ---
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [continuousScan, setContinuousScan] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Voice / Speech Recognition States ---
  const [isListening, setIsListening] = useState<boolean>(false);
  const [handsFreeMode, setHandsFreeMode] = useState<boolean>(false);
  const [voiceCommand, setVoiceCommand] = useState<string>("");
  const [typedCommand, setTypedCommand] = useState<string>("");

  // --- Speech Synthesis (TTS) Settings ---
  const [ttsVolume, setTtsVolume] = useState<number>(1.0);
  const [ttsRate, setTtsRate] = useState<number>(1.1); // Slightly faster by default for accessibility
  const [ttsPitch, setTtsPitch] = useState<number>(1.0);
  const [ttsVoice, setTtsVoice] = useState<string>("");
  const [voicesList, setVoicesList] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [currentSpeechText, setCurrentSpeechText] = useState<string>("");

  // --- AI Results & History ---
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // --- Refs to prevent stale closures in async browser Speech APIs ---
  const handsFreeModeRef = useRef<boolean>(false);
  const isAnalyzingRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);

  useEffect(() => {
    handsFreeModeRef.current = handsFreeMode;
  }, [handsFreeMode]);

  useEffect(() => {
    isAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // --- References ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ttsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const continuousIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- Load voices on startup ---
  useEffect(() => {
    const updateVoices = () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const voices = window.speechSynthesis.getVoices();
        setVoicesList(voices);
        // Default to an English voice (prefer Google US English or standard)
        const defaultVoice = voices.find(
          (v) => v.lang.includes("en-US") || v.lang.includes("en-GB") || v.default
        );
        if (defaultVoice && !ttsVoice) {
          setTtsVoice(defaultVoice.name);
        }
      }
    };

    updateVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // --- Speech Recognition Setup ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";

        rec.onstart = () => {
          setIsListening(true);
          setErrorMsg(null);
          // Only announce if NOT in hands-free mode to avoid self-talk issues
          if (!handsFreeModeRef.current) {
            speakOutLoud("Listening to your command.");
          }
        };

        rec.onresult = (event: any) => {
          const spokenText = event.results[0][0].transcript;
          setVoiceCommand(spokenText);
          setTypedCommand(spokenText);
          
          const lowerText = spokenText.toLowerCase();
          if (
            lowerText.includes("disable hands free") ||
            lowerText.includes("disable hands-free") ||
            lowerText.includes("stop hands-free") ||
            lowerText.includes("stop hands free") ||
            lowerText.includes("turn off hands free") ||
            lowerText.includes("turn off hands-free")
          ) {
            setHandsFreeMode(false);
            speakOutLoud("Hands-free conversational mode disabled.");
            return;
          }

          // Auto trigger analyze with spoken text
          triggerAnalysis(spokenText);
        };

        rec.onerror = (e: any) => {
          console.error("Speech recognition error", e);
          setIsListening(false);
          if (e.error === "no-speech") {
            // Keep it quiet in hands-free mode to avoid intrusive spoken error messages when silent
            if (!handsFreeModeRef.current) {
              speakOutLoud("No speech was detected. Please try again.");
            }
          } else {
            setErrorMsg(`Voice recognition failed: ${e.error}`);
          }
        };

        rec.onend = () => {
          setIsListening(false);
          // Automatically restart recognition in hands-free mode if we're not speaking or analyzing
          if (handsFreeModeRef.current && !isAnalyzingRef.current && !isSpeakingRef.current) {
            setTimeout(() => {
              if (handsFreeModeRef.current && !isAnalyzingRef.current && !isSpeakingRef.current && !isListeningRef.current) {
                try {
                  recognitionRef.current?.start();
                } catch (e) {
                  // Already running or failed
                }
              }
            }, 1000);
          }
        };

        recognitionRef.current = rec;
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [cameraActive, uploadedImage, result, ttsVoice, ttsRate, ttsVolume, ttsPitch]);

  // --- Start & Stop Camera ---
  const startCamera = async () => {
    try {
      setErrorMsg(null);
      let stream: MediaStream;
      try {
        // Try requesting environment (back-facing camera) with ideal dimensions first
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
        });
      } catch (innerErr) {
        console.warn("Environmental video constraint failed, falling back to simple video constraint", innerErr);
        // Fallback to simple default video input (highly compatible with standard front webcams & virtual cams)
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      setCameraActive(true);
      setUploadedImage(null); // Clear uploaded snapshot if we run the camera

      // Allow DOM to update and assign the stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((playErr) => {
            console.error("Video play failed:", playErr);
          });
          speakOutLoud("Webcam active. Ready to assist.");
        } else {
          console.error("videoRef.current is null even after setting cameraActive to true");
          // Fallback direct assignment if immediate
          const videoElement = document.querySelector("video");
          if (videoElement) {
            (videoElement as HTMLVideoElement).srcObject = stream;
            (videoElement as HTMLVideoElement).play().catch(() => {});
          }
        }
      }, 100);

    } catch (err: any) {
      console.error("Camera access error:", err);
      setErrorMsg("Unable to access laptop camera. Please grant camera permission, or use the File Upload alternative below to select or drag images.");
      speakOutLoud("Camera not found or permission denied. Please allow camera access or upload an image instead.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setContinuousScan(false);
    speakOutLoud("Camera disabled.");
  };

  // --- Drag & Drop & Upload Handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processSelectedFile(file);
    } else {
      speakOutLoud("Please upload or drop a valid image file.");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const processSelectedFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setUploadedImage(reader.result);
        stopCamera(); // Turn off camera stream to focus on the uploaded image
        speakOutLoud("Image uploaded successfully. Tap the Scan button or ask a question to analyze.");
      }
    };
    reader.onerror = () => {
      speakOutLoud("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const clearUploadedImage = () => {
    setUploadedImage(null);
    speakOutLoud("Uploaded image cleared.");
  };

  const loadSampleMockup = (svgString: string, announcement: string) => {
    speakOutLoud("Loading sample image...");
    
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, 640, 480);
        ctx.drawImage(img, 0, 0);
        const jpegBase64 = canvas.toDataURL("image/jpeg", 0.95);
        setUploadedImage(jpegBase64);
        stopCamera();
        speakOutLoud(announcement);
      } else {
        setUploadedImage(svgString);
        stopCamera();
        speakOutLoud(announcement);
      }
    };
    img.onerror = (e) => {
      console.error("Failed to load SVG into Image:", e);
      setUploadedImage(svgString);
      stopCamera();
      speakOutLoud(announcement);
    };
    
    const cleanedSvg = svgString.replace("data:image/svg+xml;utf8,", "");
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(cleanedSvg)));
  };

  // --- Voice Commands Listening Trigger ---
  const toggleListening = () => {
    if (!cameraActive && !uploadedImage) {
      speakOutLoud("Please turn on the camera or upload an image before speaking a command.");
      setErrorMsg("Camera or uploaded snapshot must be active to scan surroundings.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      // Stop any current text-to-speech first
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.error("Start speech recognition failed:", e);
        setErrorMsg("Failed to start speech recognition. Try clicking again.");
      }
    }
  };

  // --- Toggle Hands-Free conversational mode ---
  const toggleHandsFreeMode = () => {
    const nextMode = !handsFreeMode;
    setHandsFreeMode(nextMode);
    
    if (nextMode) {
      // If turning ON, ensure camera starts if not already active
      if (!cameraActive && !uploadedImage) {
        startCamera();
      }
      speakOutLoud(
        "Hands-free conversational mode activated. I am listening continuously now. Just speak your command anytime. Say disable hands free to stop."
      );
    } else {
      speakOutLoud("Hands-free conversational mode deactivated.");
      try {
        recognitionRef.current?.abort();
      } catch (e) {}
    }
  };

  // --- Web Speech Synthesis (TTS) Helper ---
  const speakOutLoud = (text: string) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      // Cancel active speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = ttsVolume;
      utterance.rate = ttsRate;
      utterance.pitch = ttsPitch;

      if (ttsVoice) {
        const foundVoice = voicesList.find((v) => v.name === ttsVoice);
        if (foundVoice) utterance.voice = foundVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        setCurrentSpeechText(text);
        // Temporarily abort microphone while speaking to prevent mic feedback loops
        if (handsFreeModeRef.current) {
          try {
            recognitionRef.current?.abort();
          } catch (e) {}
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        // In hands-free mode, restart listening automatically after speaking completes
        if (handsFreeModeRef.current && !isAnalyzingRef.current) {
          setTimeout(() => {
            if (handsFreeModeRef.current && !isAnalyzingRef.current && !isSpeakingRef.current && !isListeningRef.current) {
              try {
                recognitionRef.current?.start();
              } catch (e) {
                console.warn("Could not auto-start recognition after speech:", e);
              }
            }
          }, 1000);
        }
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        if (handsFreeModeRef.current && !isAnalyzingRef.current) {
          setTimeout(() => {
            if (handsFreeModeRef.current && !isAnalyzingRef.current && !isSpeakingRef.current && !isListeningRef.current) {
              try {
                recognitionRef.current?.start();
              } catch (e) {}
            }
          }, 1000);
        }
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  // --- Extract Snapshot & Send to AI Backend ---
  const triggerAnalysis = async (commandOverride?: string) => {
    if (!cameraActive && !uploadedImage) {
      speakOutLoud("Please activate the camera or upload an image first.");
      setErrorMsg("No active camera stream or uploaded snapshot to analyze.");
      return;
    }

    if (isAnalyzing) return;

    setIsAnalyzing(true);
    setErrorMsg(null);

    // Give visual haptic and speech cue if requested directly
    if (commandOverride) {
      setVoiceCommand(commandOverride);
    } else {
      setVoiceCommand("");
    }

    try {
      let base64Image = "";

      if (cameraActive) {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) {
          throw new Error("Video or Canvas elements not initialized.");
        }

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Could not acquire 2D canvas context.");
        }

        // Draw the video frame onto canvas
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert frame to Base64 (JPEG format)
        base64Image = canvas.toDataURL("image/jpeg", 0.8);
      } else if (uploadedImage) {
        base64Image = uploadedImage;
      }

      if (!base64Image) {
        throw new Error("Failed to capture or read image frame.");
      }

      // Prepare payload with contextual memory history to avoid repetitions
      const historySummaryList = history.map((h) => h.spokenSummary);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64Image,
          command: commandOverride || typedCommand || undefined,
          history: historySummaryList
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Server failed to process environment image.");
      }

      const data: AnalysisResult = await response.json();
      setResult(data);

      // Speak out the results naturally!
      if (data.spokenSummary) {
        speakOutLoud(data.spokenSummary);
      }

      // Append to announcement logs
      const newHistoryItem: HistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        spokenSummary: data.spokenSummary,
        command: commandOverride || typedCommand || undefined,
        urgency: data.urgency,
        objectsCount: data.detectedObjects?.length || 0
      };

      setHistory((prev) => [newHistoryItem, ...prev.slice(0, 24)]);
      setTypedCommand(""); // reset command input after search

    } catch (err: any) {
      console.error("AI Analysis Error:", err);
      setErrorMsg(err.message || "An error occurred during scene analysis.");
      speakOutLoud("Error analyzing scene. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Keyboard Shortcuts (Crucial Accessibility) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Spacebar toggles voice command (if not currently focused in text input)
      if (e.code === "Space" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        toggleListening();
      }
      // Escape stops speech immediately
      if (e.code === "Escape") {
        e.preventDefault();
        stopSpeaking();
      }
      // 'h' or 'H' toggles hands-free continuous conversational mode
      if ((e.key === "h" || e.key === "H") && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        toggleHandsFreeMode();
      }
      // 'c' or 'C' toggles continuous mode (outside of inputs)
      if ((e.key === "c" || e.key === "C") && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (cameraActive) {
          setContinuousScan((prev) => !prev);
          speakOutLoud(!continuousScan ? "Continuous assistant mode activated." : "Continuous assistant mode deactivated.");
        } else {
          speakOutLoud("Please start the camera before enabling continuous mode.");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cameraActive, continuousScan, isListening, handsFreeMode]);

  // --- Continuous Assist Loop ---
  useEffect(() => {
    if (continuousScan && cameraActive) {
      speakOutLoud("Continuous assist mode active. Scanning environment every six seconds.");
      // Initial scan
      triggerAnalysis();

      continuousIntervalRef.current = setInterval(() => {
        if (!isAnalyzing) {
          triggerAnalysis();
        }
      }, 6500); // 6.5s interval to ensure smooth execution and avoid api throttling
    } else {
      if (continuousIntervalRef.current) {
        clearInterval(continuousIntervalRef.current);
      }
    }

    return () => {
      if (continuousIntervalRef.current) {
        clearInterval(continuousIntervalRef.current);
      }
    };
  }, [continuousScan, cameraActive]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white">
      {/* Invisible canvas for capturing image frames */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Global ARIA live region for screen readers */}
      <div className="sr-only" aria-live="assertive">
        {currentSpeechText}
      </div>

      {/* Top Banner / Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 shadow-lg shadow-sky-500/20">
              <Compass className="h-6 w-6 text-white animate-pulse" />
              {cameraActive && continuousScan && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-white flex items-center gap-2">
                OneAssist AI
                <span className="text-xs font-mono font-normal bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded-full border border-sky-500/20">
                  v1.2 Accessibility Platform
                </span>
              </h1>
              <p className="text-xs text-slate-400">Multimodal Assistant for Visually Impaired Users</p>
            </div>
          </div>

          {/* Quick Stats / System indicators */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-mono">
              <span className={`h-2.5 w-2.5 rounded-full ${cameraActive ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <span>Camera: {cameraActive ? "ACTIVE" : "OFFLINE"}</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-mono">
              <span className={`h-2.5 w-2.5 rounded-full ${continuousScan ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span>Continuous Mode: {continuousScan ? "ON" : "OFF"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        
        {/* Error notification */}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 text-red-200">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold">System Alert</p>
              <p className="text-red-300/90">{errorMsg}</p>
            </div>
            <button 
              onClick={() => setErrorMsg(null)}
              className="text-red-400 hover:text-red-200 transition text-xs font-semibold underline px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT: Camera Viewport & Quick Controls (Grid col-span 5) */}
          <section className="lg:col-span-5 flex flex-col gap-5">
            
            {/* Webcam Stream / File Upload Card */}
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`bg-slate-900 border rounded-2xl overflow-hidden shadow-2xl relative flex flex-col min-h-[440px] transition-all duration-300 ${
                isDragging ? "border-sky-500 bg-sky-950/20 ring-2 ring-sky-500/50" : "border-slate-800"
              }`}
            >
              <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                <h2 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase flex items-center gap-2">
                  <Camera className="h-4 w-4 text-sky-400" />
                  Live Feed or Uploaded Image
                </h2>
                {cameraActive ? (
                  <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    STREAMING
                  </span>
                ) : uploadedImage ? (
                  <span className="text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-sky-400" />
                    SNAPSHOT READY
                  </span>
                ) : (
                  <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2.5 py-0.5 rounded-full font-mono">
                    STANDBY
                  </span>
                )}
              </div>

              {/* Video or Static Image Frame Container */}
              <div className="flex-1 relative bg-slate-950 flex items-center justify-center overflow-hidden min-h-[260px]">
                {/* Always keep the video element mounted in the DOM to prevent videoRef.current from being null */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover transform scale-x-[-1] ${cameraActive ? "block" : "hidden"}`}
                  aria-label="Webcam feed displaying physical surroundings"
                />

                {!cameraActive && uploadedImage && (
                  <div className="w-full h-full flex flex-col items-center justify-center relative p-2">
                    <img
                      src={uploadedImage}
                      alt="Uploaded environment screenshot"
                      referrerPolicy="no-referrer"
                      className="max-w-full max-h-[280px] object-contain rounded-lg border border-slate-800"
                    />
                    <button
                      onClick={clearUploadedImage}
                      className="absolute top-3 right-3 bg-red-950/90 text-red-400 border border-red-800/60 p-2 rounded-xl hover:bg-red-900 transition shadow-lg focus-ring"
                      title="Clear uploaded snapshot"
                      aria-label="Clear uploaded snapshot"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 transform -translate-x-1/2 bg-slate-950/80 backdrop-blur-sm border border-slate-800 text-[11px] text-slate-300 font-mono px-3 py-1 rounded-full text-center">
                      Static Snapshot Active
                    </div>
                  </div>
                )}

                {!cameraActive && !uploadedImage && (
                  <div className="text-center p-6 flex flex-col items-center gap-3 w-full">
                    <div className="h-14 w-14 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400 border border-slate-700 shadow-inner">
                      <CameraOff className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-slate-200 text-sm font-semibold">Enable Webcam or Drag & Drop File</p>
                      <p className="text-xs text-slate-400 max-w-xs mt-1">
                        If your camera is blocked inside this sandbox iframe, you can upload any image, use drag-and-drop, or test using the sample buttons below!
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full max-w-xs justify-center">
                      <button
                        onClick={startCamera}
                        className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-lg shadow-sky-500/10 active:scale-[0.98] transition focus-ring"
                      >
                        Start Web Camera
                      </button>

                      <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold border border-slate-700 cursor-pointer text-center active:scale-[0.98] transition focus-ring">
                        <Upload className="h-3.5 w-3.5 inline mr-1.5 align-text-bottom" />
                        Choose File
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileSelect}
                          className="hidden"
                          aria-label="Choose image file to analyze"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Simulated Radar Sonar Circle overlays when scanning */}
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-sky-500/15 backdrop-blur-xs flex items-center justify-center">
                    <div className="relative flex h-32 w-32 items-center justify-center">
                      <span className="animate-radar absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="animate-radar [animation-delay:0.5s] absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-50"></span>
                      <div className="relative h-16 w-16 rounded-full bg-sky-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/30 border border-sky-400">
                        <RefreshCw className="h-8 w-8 animate-spin" />
                      </div>
                    </div>
                    <p className="absolute bottom-6 bg-slate-900/90 text-white px-4 py-1.5 rounded-full text-xs font-mono tracking-wider border border-slate-700 uppercase">
                      Gemini Multimodal Analysis...
                    </p>
                  </div>
                )}
              </div>

              {/* Video Bottom Panel (Quick toggle triggers) */}
              {(cameraActive || uploadedImage) && (
                <div className="p-4 bg-slate-900/80 border-t border-slate-800 grid grid-cols-2 gap-3">
                  {cameraActive ? (
                    <button
                      onClick={stopCamera}
                      className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-xl text-xs font-semibold border border-slate-700 transition focus-ring"
                    >
                      <CameraOff className="h-4 w-4" /> Stop Camera
                    </button>
                  ) : (
                    <button
                      onClick={clearUploadedImage}
                      className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-xl text-xs font-semibold border border-slate-700 transition focus-ring"
                    >
                      <Trash2 className="h-4 w-4" /> Clear Snapshot
                    </button>
                  )}
                  <button
                    onClick={() => triggerAnalysis()}
                    disabled={isAnalyzing}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white py-2.5 px-4 rounded-xl text-xs font-semibold shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-50 transition focus-ring"
                  >
                    <Sparkles className="h-4 w-4" /> Scan Scene
                  </button>
                </div>
              )}
            </div>

            {/* Sandbox Mockup Quick Presets */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
              <h3 className="text-xs font-semibold tracking-wide text-slate-400 font-display uppercase mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                No Camera? Test with Interactive Samples
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    loadSampleMockup(
                      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480' viewBox='0 0 640 480'><rect width='100%' height='100%' fill='%23111827'/><rect x='80' y='120' width='480' height='240' rx='12' fill='%230f766e' stroke='%2314b8a6' stroke-width='6'/><text x='320' y='210' fill='white' font-family='sans-serif' font-size='26' font-weight='bold' text-anchor='middle'>RESERVE BANK OF INDIA</text><text x='320' y='280' fill='%23a7f3d0' font-family='monospace' font-size='42' font-weight='bold' text-anchor='middle'>₹500 RUPEES</text><text x='320' y='330' fill='%235eead4' font-family='sans-serif' font-size='14' text-anchor='middle'>Stone grey Mahatma Gandhi currency note</text></svg>",
                      "Sample 500 Rupees note mockup loaded. Click Scan Scene below or ask a question to identify it."
                    );
                  }}
                  className="bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 rounded-xl p-2.5 text-slate-300 text-center transition focus-ring flex flex-col items-center justify-center gap-1"
                >
                  <Coins className="h-4 w-4 text-emerald-400" />
                  <span className="text-[10px] font-semibold">₹500 Note</span>
                </button>

                <button
                  onClick={() => {
                    loadSampleMockup(
                      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480' viewBox='0 0 640 480'><rect width='100%' height='100%' fill='%23111827'/><rect x='220' y='80' width='200' height='320' rx='20' fill='%23334155' stroke='%23f43f5e' stroke-width='6'/><rect x='220' y='140' width='200' height='160' fill='white'/><text x='320' y='190' fill='%230f172a' font-family='sans-serif' font-size='20' font-weight='bold' text-anchor='middle'>CROCIN COLD</text><text x='320' y='220' fill='%23e11d48' font-family='sans-serif' font-size='14' text-anchor='middle'>Paracetamol 500mg</text><text x='320' y='260' fill='%23475569' font-family='sans-serif' font-size='11' text-anchor='middle'>Take 1 tablet every 6 hours</text></svg>",
                      "Sample Medicine Bottle label loaded. Click Scan Scene to read active ingredients and usage."
                    );
                  }}
                  className="bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 rounded-xl p-2.5 text-slate-300 text-center transition focus-ring flex flex-col items-center justify-center gap-1"
                >
                  <Pill className="h-4 w-4 text-rose-400" />
                  <span className="text-[10px] font-semibold">Medicine Label</span>
                </button>

                <button
                  onClick={() => {
                    loadSampleMockup(
                      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480' viewBox='0 0 640 480'><rect width='100%' height='100%' fill='%23111827'/><rect x='160' y='60' width='320' height='360' rx='8' fill='%23f8fafc' stroke='%2338bdf8' stroke-width='4'/><text x='320' y='120' fill='%230f172a' font-family='sans-serif' font-size='22' font-weight='bold' text-anchor='middle'>ACCESSIBILITY REPORT</text><line x1='200' y1='150' x2='440' y2='150' stroke='%2394a3b8' stroke-width='3'/><text x='200' y='190' fill='%23334155' font-family='sans-serif' font-size='14'>OneAssist AI platform delivers state of</text><text x='200' y='220' fill='%23334155' font-family='sans-serif' font-size='14'>the art multimodal assistance to visually</text><text x='200' y='250' fill='%23334155' font-family='sans-serif' font-size='14'>impaired users. The technology leverages</text><text x='200' y='280' fill='%23334155' font-family='sans-serif' font-size='14'>computer vision and speech synthesis.</text></svg>",
                      "Sample Document loaded. Click Scan Scene to perform OCR on the text."
                    );
                  }}
                  className="bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 rounded-xl p-2.5 text-slate-300 text-center transition focus-ring flex flex-col items-center justify-center gap-1"
                >
                  <BookOpen className="h-4 w-4 text-sky-400" />
                  <span className="text-[10px] font-semibold">Printed Document</span>
                </button>
              </div>
            </div>

            {/* Quick Assist Actions Bento Block */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h3 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase mb-4 flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-sky-400" />
                Assist Preset Triggers
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => triggerAnalysis("Describe my surroundings and identify potential obstacles.")}
                  disabled={(!cameraActive && !uploadedImage) || isAnalyzing}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition focus-ring disabled:opacity-40 text-center gap-2"
                >
                  <Compass className="h-5 w-5 text-sky-400" />
                  <span className="text-xs font-semibold">Describe Scene</span>
                </button>
                <button
                  onClick={() => triggerAnalysis("Read the printed text, document, or signage aloud clearly.")}
                  disabled={(!cameraActive && !uploadedImage) || isAnalyzing}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition focus-ring disabled:opacity-40 text-center gap-2"
                >
                  <BookOpen className="h-5 w-5 text-emerald-400" />
                  <span className="text-xs font-semibold">Read Text (OCR)</span>
                </button>
                <button
                  onClick={() => triggerAnalysis("Identify if there are any Indian currency notes present in front of the camera and specify their denomination value.")}
                  disabled={(!cameraActive && !uploadedImage) || isAnalyzing}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition focus-ring disabled:opacity-40 text-center gap-2"
                >
                  <Coins className="h-5 w-5 text-amber-400" />
                  <span className="text-xs font-semibold">Scan Currency</span>
                </button>
                <button
                  onClick={() => triggerAnalysis("Identify this medicine bottle or strip. Read out the medicine name, chemical ingredients, and safety warnings.")}
                  disabled={(!cameraActive && !uploadedImage) || isAnalyzing}
                  className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition focus-ring disabled:opacity-40 text-center gap-2"
                >
                  <Pill className="h-5 w-5 text-rose-400" />
                  <span className="text-xs font-semibold">Medicine Label</span>
                </button>
              </div>

              {/* Continuous Scanner Assist Toggle */}
              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300">Continuous Assist Mode</h4>
                  <p className="text-[11px] text-slate-400">Scans and reports changes automatically every 6s</p>
                </div>
                <button
                  onClick={() => {
                    if (!cameraActive) {
                      speakOutLoud("Please start the camera stream first.");
                      return;
                    }
                    setContinuousScan(!continuousScan);
                    speakOutLoud(!continuousScan ? "Continuous assistance active." : "Continuous assist turned off.");
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                    continuousScan ? "bg-emerald-500" : "bg-slate-700"
                  }`}
                  role="switch"
                  aria-checked={continuousScan}
                  aria-label="Continuous scan assist"
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      continuousScan ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* RIGHT: Speech Assistant & Real-time Bento Visualizer (Grid col-span 7) */}
          <section className="lg:col-span-7 flex flex-col gap-5">
            
            {/* Dynamic Speech Assistant Console */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 h-24 w-24 bg-gradient-to-br from-sky-500/10 to-transparent rounded-full blur-xl pointer-events-none" />
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <h3 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase flex items-center gap-2">
                  <Mic className="h-4 w-4 text-sky-400 animate-pulse" />
                  Voice Assistant Console
                </h3>
                {isSpeaking && (
                  <span className="text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 font-mono">
                    <span className="flex items-center gap-0.5 h-3">
                      <span className="voice-bar inline-block w-0.5 bg-sky-400 h-full" />
                      <span className="voice-bar [animation-delay:0.2s] inline-block w-0.5 bg-sky-400 h-2/3" />
                      <span className="voice-bar [animation-delay:0.4s] inline-block w-0.5 bg-sky-400 h-4/5" />
                    </span>
                    SPEAKING OUT LOUD
                  </span>
                )}
              </div>

              {/* Hands-Free Conversational Mode Toggle Banner */}
              <div className="mb-4 p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full shrink-0 ${handsFreeMode ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-600'}`} />
                  <div className="text-left">
                    <h4 className="text-xs font-semibold text-slate-200">Conversational Hands-Free Mode</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {handsFreeMode 
                        ? "Continuous listening active. Speak anytime without tapping. Say \"disable hands free\" to stop."
                        : "Turn on to speak continuously without needing to tap the mic button repeatedly."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleHandsFreeMode}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition active:scale-[0.98] ${
                    handsFreeMode 
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  }`}
                >
                  {handsFreeMode ? "Disable (Key H)" : "Enable Hands-Free"}
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center min-h-[140px] text-center relative">
                {isListening ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white animate-pulse">
                      <Mic className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-400">Listening to your surroundings...</p>
                      <p className="text-xs text-slate-500 font-mono mt-1">Speak clearly. Say "What is in front of me?"</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 w-full">
                    {/* Big Voice Button */}
                    <button
                      onClick={toggleListening}
                      aria-label="Start voice command"
                      className="group relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/20 active:scale-[0.96] transition focus-ring"
                    >
                      <Mic className="h-7 w-7" />
                      <span className="absolute -inset-1 rounded-full border border-sky-400/30 animate-ping group-hover:scale-105 pointer-events-none opacity-40" />
                    </button>
                    <div>
                      <p className="text-sm font-semibold text-slate-300">Tap to Ask or Voice Command</p>
                      <p className="text-xs text-slate-500">
                        Or press <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-400">Spacebar</kbd> on your keyboard to speak
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Text Input Fallback */}
              <div className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={typedCommand}
                    onChange={(e) => setTypedCommand(e.target.value)}
                    placeholder="Type custom prompt, e.g., 'Is there any medicine bottle?'"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-3 pr-10 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        triggerAnalysis(typedCommand);
                      }
                    }}
                  />
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
                </div>
                <button
                  onClick={() => triggerAnalysis(typedCommand)}
                  disabled={(!cameraActive && !uploadedImage) || isAnalyzing || !typedCommand.trim()}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-700 transition disabled:opacity-50"
                >
                  Send
                </button>
              </div>

              {/* Voice Prompt Suggestions chips */}
              <div className="mt-4 flex flex-wrap gap-2 items-center">
                <span className="text-[10px] font-mono text-slate-500 uppercase">Suggested Prompts:</span>
                {[
                  "Describe my surroundings",
                  "What's in front of me?",
                  "Is there any obstacle?"
                ].map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setTypedCommand(s);
                      triggerAnalysis(s);
                    }}
                    disabled={(!cameraActive && !uploadedImage) || isAnalyzing}
                    className="text-xs bg-slate-800/50 hover:bg-slate-800 text-slate-300 border border-slate-700/50 px-2.5 py-1 rounded-lg transition disabled:opacity-40"
                  >
                    "{s}"
                  </button>
                ))}
              </div>

              {/* Speech Output Transcription Console */}
              {currentSpeechText && (
                <div className="mt-4 p-3 bg-slate-950 border border-sky-950/40 rounded-xl flex items-start gap-3">
                  <Volume2 className="h-4 w-4 text-sky-400 shrink-0 mt-0.5 animate-bounce" />
                  <div className="flex-1">
                    <p className="text-[10px] font-mono text-sky-400 uppercase tracking-wider">Audio Output Transcript</p>
                    <p className="text-sm text-slate-300 italic">"{currentSpeechText}"</p>
                  </div>
                  <button
                    onClick={stopSpeaking}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium px-2 py-0.5 rounded-md text-slate-300 shrink-0"
                    aria-label="Stop text to speech"
                  >
                    Stop Voice
                  </button>
                </div>
              )}

              {/* Web Speech TTS Config Accordion */}
              <div className="mt-4 pt-4 border-t border-slate-800">
                <details className="group">
                  <summary className="list-none flex items-center justify-between cursor-pointer text-xs font-mono text-slate-400 select-none hover:text-slate-200">
                    <span className="flex items-center gap-1.5">
                      <Sliders className="h-3.5 w-3.5 text-sky-400" />
                      Configure TTS Speech Synthesizer Voice & Settings
                    </span>
                    <ChevronRight className="h-4 w-4 transition transform group-open:rotate-90 text-slate-500" />
                  </summary>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-2 text-xs">
                    {/* Select Accent Voice */}
                    <div className="flex flex-col gap-1">
                      <label className="text-slate-400 font-medium">Synthesizer Accent Voice</label>
                      <select
                        value={ttsVoice}
                        onChange={(e) => {
                          setTtsVoice(e.target.value);
                          setTimeout(() => speakOutLoud("Voice setting updated."), 200);
                        }}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 focus:outline-none focus:border-sky-500 transition"
                      >
                        {voicesList.map((voice, idx) => (
                          <option key={idx} value={voice.name}>
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Speed Rate */}
                    <div className="flex flex-col gap-1 justify-center">
                      <div className="flex justify-between">
                        <label className="text-slate-400 font-medium">Speech Rate (Speed)</label>
                        <span className="font-mono text-sky-400 font-bold">{ttsRate}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={ttsRate}
                        onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                        className="accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Pitch Slider */}
                    <div className="flex flex-col gap-1 justify-center">
                      <div className="flex justify-between">
                        <label className="text-slate-400 font-medium">Speech Pitch</label>
                        <span className="font-mono text-sky-400 font-bold">{ttsPitch}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.1"
                        value={ttsPitch}
                        onChange={(e) => setTtsPitch(parseFloat(e.target.value))}
                        className="accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Volume Slider */}
                    <div className="flex flex-col gap-1 justify-center">
                      <div className="flex justify-between">
                        <label className="text-slate-400 font-medium">Speech Volume</label>
                        <span className="font-mono text-sky-400 font-bold">{Math.round(ttsVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.1"
                        value={ttsVolume}
                        onChange={(e) => setTtsVolume(parseFloat(e.target.value))}
                        className="accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </details>
              </div>
            </div>

            {/* AI Results Bento Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex-1 flex flex-col gap-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sky-400" />
                  Live Environment Analysis
                </h3>
                {result && (
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase border ${
                    result.urgency === "high"
                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : result.urgency === "medium"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                  }`}>
                    Urgency: {result.urgency}
                  </span>
                )}
              </div>

              {result ? (
                <div className="flex-1 flex flex-col gap-4">
                  
                  {/* Scene Description Text */}
                  <div>
                    <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">Scene Description</h4>
                    <p className="text-sm text-slate-200 leading-relaxed font-sans">{result.sceneDescription}</p>
                  </div>

                  {/* Grid layout for detected objects + OCR read text */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Detected Obstacles / Objects bento */}
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4">
                      <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>Physical Elements</span>
                        <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full font-bold">
                          {result.detectedObjects?.length || 0} found
                        </span>
                      </h4>

                      {result.detectedObjects && result.detectedObjects.length > 0 ? (
                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                          {result.detectedObjects.map((obj, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-slate-900/60 p-2 rounded-lg border border-slate-800 text-xs">
                              <div>
                                <p className="font-semibold text-slate-200">{obj.name}</p>
                                {obj.details && <p className="text-[10px] text-slate-400">{obj.details}</p>}
                              </div>
                              <div className="flex gap-1">
                                <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/50 text-[9px] font-mono">
                                  {obj.location}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                                  obj.distance === "near" 
                                    ? "bg-red-950 text-red-300 border-red-800/50" 
                                    : "bg-slate-800 text-slate-300 border-slate-700"
                                }`}>
                                  {obj.distance}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic mt-4 text-center">No distinct objects logged.</p>
                      )}
                    </div>

                    {/* OCR Text Read */}
                    <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex flex-col">
                      <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-emerald-400" />
                        OCR Text / Labels read
                      </h4>
                      {result.textRead ? (
                        <div className="flex-1 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800 max-h-[160px] overflow-y-auto font-mono text-xs text-emerald-300 leading-normal">
                          {result.textRead}
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center border border-dashed border-slate-800 rounded-lg p-4 text-slate-500 text-center text-xs italic">
                          No text detected in scene.
                        </div>
                      )}
                    </div>

                  </div>

                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-slate-800 rounded-2xl min-h-[220px]">
                  <Compass className="h-10 w-10 text-slate-600 mb-2 animate-spin [animation-duration:12s]" />
                  <p className="text-slate-400 text-sm font-medium">Waiting for Scene Scan</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Click "Scan Scene" or press the Voice Assistant button and say a command like "Describe my surroundings" to get instant visual insights.
                  </p>
                </div>
              )}
            </div>

          </section>

        </div>

        {/* BOTTOM PANEL: Announcement History Log & Accessibility Guide */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Spoken Announcement Log History (col-span 8) */}
          <div className="md:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
            <h3 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-400" />
              Announcement History Log (Contextual Memory)
            </h3>
            
            {history.length > 0 ? (
              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                {history.map((item) => (
                  <div key={item.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-start gap-3 text-xs">
                    <div className="bg-slate-900 px-2 py-1.5 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-400 text-center shrink-0">
                      {item.timestamp}
                    </div>
                    <div className="flex-1">
                      {item.command && (
                        <p className="text-[10px] font-mono text-indigo-400 font-semibold mb-0.5">
                          Query: "{item.command}"
                        </p>
                      )}
                      <p className="text-slate-200 leading-relaxed font-sans font-medium">"{item.spokenSummary}"</p>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 uppercase ${
                      item.urgency === "high" 
                        ? "bg-red-950 text-red-400 border border-red-900/30" 
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}>
                      {item.urgency}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-xl">
                No recent announcements made. Start a scan or voice query to populate history.
              </p>
            )}
          </div>

          {/* Accessibility Guide Instructions (col-span 4) */}
          <div className="md:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-semibold tracking-wide text-slate-300 font-display uppercase mb-4 flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-sky-400" />
              Accessibility & Keyboard Guide
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              OneAssist AI is engineered for keyboard and screen-reader accessibility. Use these global shortcuts for zero-sight operations:
            </p>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-300">Trigger Voice Assistant</span>
                  <span className="text-[10px] text-slate-500">Tap to record voice queries</span>
                </div>
                <kbd className="bg-slate-850 px-2 py-1 rounded text-xs font-mono font-semibold border border-slate-700 text-sky-400">Spacebar</kbd>
              </div>

              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-300">Stop Speech Audio</span>
                  <span className="text-[10px] text-slate-500">Mutes current reading voice</span>
                </div>
                <kbd className="bg-slate-850 px-2 py-1 rounded text-xs font-mono font-semibold border border-slate-700 text-sky-400">Escape</kbd>
              </div>

              <div className="flex items-center justify-between pb-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-300">Continuous Assist Toggle</span>
                  <span className="text-[10px] text-slate-500">Starts/stops the 6s scanning loop</span>
                </div>
                <kbd className="bg-slate-850 px-2 py-1 rounded text-xs font-mono font-semibold border border-slate-700 text-sky-400">C Key</kbd>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-indigo-950/20 border border-indigo-900/30 rounded-xl text-[11px] text-slate-300 leading-relaxed">
              <span className="font-semibold text-indigo-400 block mb-0.5">Companion Tip:</span>
              Plug in headphones or enable a native screen reader to fully experience standard visual-to-audio feedback. Set speed rate higher for experienced speed-listeners.
            </div>
          </div>

        </section>

      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-slate-900 bg-slate-950/80 py-6 text-center text-xs text-slate-500 font-mono">
        <p>OneAssist AI Accessibility Platform • Supported by Gemini multimodal vision models</p>
      </footer>
    </div>
  );
}
