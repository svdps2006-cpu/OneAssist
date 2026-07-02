export interface DetectedObject {
  name: string;
  location: "left" | "right" | "ahead";
  distance: "near" | "far";
  category: "person" | "obstacle" | "currency" | "medicine" | "text_document" | "qr_code" | "general";
  details?: string;
}

export interface AnalysisResult {
  sceneDescription: string;
  detectedObjects: DetectedObject[];
  textRead: string;
  urgency: "high" | "medium" | "low";
  spokenSummary: string;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  spokenSummary: string;
  command?: string;
  urgency: "high" | "medium" | "low";
  objectsCount: number;
}
