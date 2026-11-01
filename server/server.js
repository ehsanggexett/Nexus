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

function isTemporaryError(error) {
  const status = Number(error.status || error.code);
  return [429, 500, 502, 503, 504].includes(status);
}

async function askGroq(message) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
       "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "user", content: message }
        ]
      })
    }
  );

  const data = await response.json();

const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Groq API Error ${response.status}: ${data.error?.message || "Unknown error"}`
    );
  }
  return data.choices?.[0]?.message?.content ||
    "پاسخی دریافت نشد.";
}

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
        error: "کلید Gemini روی سرور تنظیم نشده است."
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    let geminiResponse;
    let geminiError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        geminiResponse = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: message.trim()
        });

        break;
      } catch (error) {
        geminiError = error;

        if (!isTemporaryError(error)) {
          throw error;
        }

        console.log(`Gemini retry ${attempt}/3`);

        if (attempt < 3) {
          await new Promise(resolve =>
            setTimeout(resolve, attempt * 2000)
          );
        }
      }
    }

    if (geminiResponse?.text) {
      return res.json({
        reply: geminiResponse.text,
        provider: "Gemini"
      });
    }

    if (geminiError) {
      console.log("Gemini unavailable. Switching to Groq...");
    }

    const groqReply = await askGroq(message.trim());

    return res.json({
      reply: groqReply,
      provider: "Groq"
    });

  } catch (error) {
    console.error("AI Error:", error.message);

    res.status(500).json({
      error: "ارتباط با هوش مصنوعی با مشکل مواجه شد."
    });
  }
});

app.listen(PORT, () => {
  console.log("Siman AI running on port " + PORT);
});
