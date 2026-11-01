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

    let response;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: message.trim()
        });

        break;
      } catch (error) {
        const status = error.status || error.code;

        if (
          attempt === maxAttempts ||
          ![429, 500, 502, 503, 504].includes(Number(status))
        ) {
          throw error;
        }

        console.log(`Retry attempt ${attempt} after error ${status}`);

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 2000)
        );
      }
    }

    res.json({
      reply: response?.text || "پاسخی دریافت نشد."
    });

  } catch (error) {
    console.error("AI Error:", error.message);

    res.status(500).json({
      error: "ارتباط با هوش مصنوعی با مشکل مواجه شد."
    });
  }
});
