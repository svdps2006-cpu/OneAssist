import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limits for base64 image data
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Serve static assets from public folder if present
app.use(express.static(path.join(process.cwd(), "public")));

// API Route: Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// API Route: Analyze Webcam Frame
app.post("/api/analyze", async (req, res) => {
  try {
    const { image, command, history } = req.body;

    if (!image) {
      return res.status(400).json({ error: "Missing webcam image data." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return res.status(500).json({
        error: "Gemini API key is not configured in this workspace. Please provide your GEMINI_API_KEY in Settings > Secrets."
      });
    }

    // Lazy load or initialize the GoogleGenAI instance with the strict requirements
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });

    // Extract mime type dynamically from data URL, default to image/jpeg
    let mimeType = "image/jpeg";
    const mimeMatch = image.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
    }

    // Strip out the data URL prefix cleanly
    const base64Data = image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Data
      }
    };

    // System instruction guiding the model to act as the "OneAssist AI" assistant
    const systemInstruction = `You are "OneAssist AI", an expert accessibility assistant designed to help visually impaired users navigate and understand their physical surroundings in real-time.
Your goal is to process the visual camera feed and any user voice command to provide context-aware, highly descriptive guidance.

Provide estimations of:
1. Object/Person name and detail.
2. Relative horizontal location: "left", "right", or "ahead".
3. Relative distance: "near" (within 2 meters, reach of hand) or "far" (beyond 2 meters).
4. Category: classify precisely to flag urgent obstacles, text/OCR labels, currency notes, medicine labels, or QR/Barcodes.

Special tasks to handle when present:
- Printed text/OCR: Extract readable text fully.
- Indian Currency notes: Identify notes (e.g., 10, 20, 50, 100, 200, 500 Rupees) and describe them.
- Medicine Labels: Identify medicine name, dosage details, and active ingredients if legible.
- QR/Barcodes: Identify if a QR/Barcode is present and read its content if possible.
- Avoid repeating descriptions if they have already been spoken in the history log, unless they have changed location/distance or are of high urgency (like an immediate obstacle).

Always return a well-formed JSON object matching the requested schema. Make sure the 'spokenSummary' is highly natural, warm, conversational, and direct for screen reader text-to-speech output. Max 2 sentences. Keep speech concise to prevent auditory fatigue.`;

    // Construct the contents part
    let userPrompt = "Analyze this environment snapshot.";
    if (command) {
      userPrompt += ` The user has spoken this question/command: "${command}". Please prioritize answering this command directly in your spokenSummary and analysis.`;
    }
    if (history && history.length > 0) {
      userPrompt += ` For context, here are the recent announcements made to the user to avoid redundant repetitions: ${JSON.stringify(history.slice(-3))}`;
    }

    const contents = {
      parts: [
        imagePart,
        { text: userPrompt }
      ]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sceneDescription: {
              type: Type.STRING,
              description: "A detailed natural description of the overall physical scene."
            },
            detectedObjects: {
              type: Type.ARRAY,
              description: "Key physical items, obstacles, or people currently visible.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Name of the object, person, or label." },
                  location: { type: Type.STRING, description: "Horizontal location relative to the user: 'left', 'right', or 'ahead'." },
                  distance: { type: Type.STRING, description: "Relative distance: 'near' (within 2m) or 'far' (beyond 2m)." },
                  category: { type: Type.STRING, description: "Category: 'person', 'obstacle', 'currency', 'medicine', 'text_document', 'qr_code', or 'general'." },
                  details: { type: Type.STRING, description: "Details (e.g. 'wearing glasses', '100 Rupee note', 'Crocin cold label')." }
                },
                required: ["name", "location", "distance", "category"]
              }
            },
            textRead: {
              type: Type.STRING,
              description: "Extracted text or label content. Leave blank or empty string if no readable text is present."
            },
            urgency: {
              type: Type.STRING,
              description: "Urgency: 'high' (obstacles/people close), 'medium', or 'low'."
            },
            spokenSummary: {
              type: Type.STRING,
              description: "Concise, friendly spoken summary designed specifically for text-to-speech, directly answering any command/question. Max 2 sentences."
            }
          },
          required: ["sceneDescription", "detectedObjects", "textRead", "urgency", "spokenSummary"]
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response received from Gemini AI model.");
    }

    const parsedResult = JSON.parse(responseText.trim());
    return res.json(parsedResult);

  } catch (error: any) {
    console.error("Analysis Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini AI analysis."
    });
  }
});

// Vite Middleware for Hot Reload & Production SPA serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`OneAssist AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
