import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

app.use(express.json({ limit: "20kb" }));
app.use(express.static(rootDir));

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "پیام معتبر نیست."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "کلید هوش مصنوعی روی سرور تنظیم نشده است."
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: message.trim()
    });

    res.json({
      reply: response.text || "پاسخی دریافت نشد."
    });

  } catch (error) {
    console.error("AI Error:", error.message);

    res.status(500).json({
      error: "ارتباط با هوش مصنوعی با مشکل مواجه شد."
    });
  }
});

app.listen(PORT, () => {
  console.log("NexusAI running on port " + PORT);
