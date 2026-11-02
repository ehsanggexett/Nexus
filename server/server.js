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

app.use(express.json({ limit: "7mb" }));
app.use(express.static(rootDir));

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
];

// سایت‌های ایرانی برای جست‌وجوی محصولات
const IRANIAN_STORE_DOMAINS = [
  "digikala.com",
  "torob.com",
  "emalls.ir",
  "technolife.ir",
  "meghdadit.com"
];

function isTemporaryError(error) {
  const status = Number(error.status || error.code);
  return [429, 500, 502, 503, 504].includes(status);
}

function validateImage(image) {
  if (!image || typeof image !== "object") {
    return null;
  }

  const mimeType = image.mimeType;
  let base64 = image.data;

  if (
    typeof mimeType !== "string" ||
    !ALLOWED_IMAGE_TYPES.includes(mimeType)
  ) {
    throw new Error("فرمت تصویر پشتیبانی نمی‌شود.");
  }

  if (typeof base64 !== "string") {
    throw new Error("اطلاعات تصویر معتبر نیست.");
  }

  if (base64.startsWith("data:")) {
    const match = base64.match(/^data:([^;]+);base64,(.+)$/);

    if (!match || match[1] !== mimeType) {
      throw new Error("اطلاعات تصویر معتبر نیست.");
    }

    base64 = match[2];
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error("داده تصویر معتبر نیست.");
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new Error("حجم تصویر باید حداکثر 5 مگابایت باشد.");
  }

  return {
    data: buffer.toString("base64"),
    mimeType
  };
}

// تشخیص درخواست‌هایی که به جست‌وجوی اینترنت نیاز دارند
function needsWebSearch(message) {
  const text = message.toLowerCase();

  const searchWords = [
    "پیدا کن",
    "پیدا کنه",
    "جستجو کن",
    "جست‌وجو کن",
    "بگرد",
    "لینک بده",
    "لینک محصول",
    "لینک خرید",
    "لینک سایت",
    "قیمت",
    "خرید",
    "فروشگاه",
    "محصول",
    "موجوده",
    "موجودی",
    "از کجا بخرم",
    "دیجی کالا",
    "دیجی‌کالا",
    "ترب",
    "emalls",
    "digikala",
    "torob",
    "find",
    "search for",
    "product link",
    "buy",
    "price"
  ];

  return searchWords.some(word => text.includes(word));
}

// جست‌وجوی واقعی در Tavily
async function searchWeb(message) {
  if (!process.env.TAVILY_API_KEY) {
    console.log("TAVILY_API_KEY is not configured.");
    return {
      results: [],
      error: "کلید جست‌وجوی اینترنت تنظیم نشده است."
    };
  }

  const response = await fetch(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.TAVILY_API_KEY
      },
      body: JSON.stringify({
        query: message,
        search_depth: "basic",
        topic: "general",
        max_results: 6,
        include_answer: false,
        include_domains: IRANIAN_STORE_DOMAINS
      })
    }
  );

  const data = await response.json();

if (!response.ok) {
    throw new Error("Tavily API Error " + response.status);
  }

  const results = (data.results || [])
    .filter(item => {
      try {
        const url = new URL(item.url);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, 6)
    .map(item => ({
      title: item.title || "صفحه بدون عنوان",
      url: item.url,
      content: item.content || ""
    }));

  return { results };
}
function createSearchContext(results) {
  if (!results.length) {
    return "";
  }

  return results.map((item, index) => {
    return (
      "Result " + (index + 1) + "\n" +
      "Title: " + item.title + "\n" +
      "URL: " + item.url + "\n" +
      "Content: " + item.content + "\n"
    );
  }).join("\n");
}

async function askGemini(message, image) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const parts = [{ text: message }];

  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data
      }
    });
  }

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts
          }
        ]
      });

      if (response.text) {
        return response.text;
      }

      throw new Error("Gemini پاسخ متنی برنگرداند.");
    } catch (error) {
      lastError = error;

      console.error(
        "Gemini attempt " + attempt + "/3 failed:",
        error.message
      );

      if (!isTemporaryError(error)) {
        break;
      }

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 2000)
        );
      }
    }
  }

  throw lastError;
}

async function askGroq(message, image) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  let model = "openai/gpt-oss-20b";
  let content = message;

  if (image) {
    model = "qwen/qwen3.8-27b";

    content = [
      {
        type: "text",
        text: message
      },
      {
        type: "image_url",
        image_url: {
          url: "data:" + image.mimeType + ";base64," + image.data
        }
      }
    ];
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content
          }
        ],
        max_completion_tokens: 2048
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      "Groq API Error " +
      response.status +
      ": " +
      (data.error?.message || "Unknown error")
    );
  }

  return data.choices?.[0]?.message?.content ||
    "پاسخی از Groq دریافت نشد.";
}

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;
    const image = validateImage(req.body.image);

    if (
      typeof message !== "string" ||
      (!message.trim() && !image)
    ) {
      return res.status(400).json({
        error: "پیام یا تصویر معتبر ارسال نشده است."
      });
    }

    const finalMessage = message.trim() ||
      "لطفاً این تصویر را بررسی و توصیف کن.";

    if (
      !process.env.GEMINI_API_KEY &&
      !process.env.GROQ_API_KEY
    ) {
      return res.status(503).json({
        error: "کلیدهای هوش مصنوعی روی سرور تنظیم نشده‌اند."
      });
    }

    // جست‌وجو فقط برای پیام‌های متنی و درخواست‌های مرتبط
    let sources = [];
    let searchContext = "";

    if (!image && needsWebSearch(finalMessage)) {
      try {
        const searchData = await searchWeb(finalMessage);
        sources = searchData.results || [];
        searchContext = createSearchContext(sources);

        console.log("Web search results:", sources.length);
      } catch (error) {
        console.error("Web Search Error:", error.message);
      }
    }
const messageForAI = searchContext
  ? "User message:\n" +
    finalMessage +
    "\n\nSearch results:\n" +
    searchContext +
    "\n\nAnswer in Persian. Use only the real URLs provided in the search results. Never invent links or prices."
  : finalMessage; 
    // تلاش اول: Gemini
    if (process.env.GEMINI_API_KEY) {
      try {
        const reply = await askGemini(messageForAI, image);

        return res.json({
          reply,
          provider: "Gemini",
          sources
        });
      } catch (error) {
        console.error(
          "Gemini unavailable. Switching to Groq:",
          error.message
        );
      }
    }

    // تلاش دوم: Groq
    if (process.env.GROQ_API_KEY) {
      try {
        const reply = await askGroq(messageForAI, image);

        return res.json({
          reply,
          provider: "Groq",
          sources
        });
      } catch (error) {
        console.error("Groq Error:", error.message);
      }
    }

    return res.status(503).json({
      error: "در حال حاضر سرویس‌های هوش مصنوعی در دسترس نیستند."
    });

  } catch (error) {
    console.error("Server Error:", error.message);

    return res.status(400).json({
      error: error.message || "در پردازش درخواست خطایی رخ داد."
    });
  }
});

app.listen(PORT, () => {
  console.log("Nexus1 AI running on port " + PORT);
});
