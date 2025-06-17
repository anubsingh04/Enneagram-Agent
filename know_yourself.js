import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VectorStore } from "./vectorStore.js";
import {
  personality_questions_prompt,
  final_personality_verdict_prompt
} from "./system_prompts_archive.js";

// Simulate __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVO_DIR = path.resolve(__dirname, "./conversations/Personality");

function getSessionFile(sessionId) {
  return path.join(CONVO_DIR, `${sessionId}.json`);
}

function loadMessages(sessionId) {
  const file = getSessionFile(sessionId);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw);
  }
  return [];
}

function saveMessages(sessionId, messages) {
  if (!fs.existsSync(CONVO_DIR)) {
    fs.mkdirSync(CONVO_DIR, { recursive: true });
  }
  const file = getSessionFile(sessionId);
  fs.writeFileSync(file, JSON.stringify(messages, null, 2));
}

function formatGeminiMessages(messages) {
  return {
    contents: [
      {
        parts: messages.map(m => ({
          text: `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
        }))
      }
    ]
  };
}

async function handleRetrievalAndVerdict(query, messages, model, apiKey, isGemini = false) {
  const vs = new VectorStore();
  const docs = await vs.search(query);
  const unique_docs = Array.from(new Set(docs.map(doc => doc.content)));
  const context = unique_docs.join('\n');

  if (isGemini) {
    const prompt = formatGeminiMessages([
      { role: "system", content: `${final_personality_verdict_prompt}\n\nBOOK:\n${context}` },
      ...messages
    ]);

    const verdictResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${apiKey}`,
      prompt,
      { headers: { "Content-Type": "application/json" } }
    );

    return verdictResp.data.candidates[0]?.content?.parts[0]?.text.trim() ?? "[No response from Gemini]";
  } else {
    const verdictResp = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "system",
            content: `${final_personality_verdict_prompt}\n\nBOOK:\n${context}`
          },
          ...messages
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    return verdictResp.data.choices[0]?.message?.content.trim() ?? "[No response from OpenRouter]";
  }
}

export async function knowYourself(req, res) {
  try {
    console.log("Got Request")
    const { sessionId, userInput } = req.body;
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    const MODEL_NAME = process.env.MODEL_NAME;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    console.log("Got Request")
    // if (!sessionId || !userInput) {
    //   return res.status(400).json({ error: "sessionId and userInput are required" });
    // }
    console.log("Got Request")
    let messages = loadMessages(sessionId);
    messages.push({ role: "user", content: userInput });
    console.log("Got Request")
    try {
      const llmResp = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: MODEL_NAME,
          messages: [
            { role: "system", content: personality_questions_prompt },
            ...messages
          ]
        },
        {
          headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const llmMessage = llmResp.data.choices[0]?.message?.content.trim() ?? "";
      messages.push({ role: "assistant", content: llmMessage });

      let responseMessage = llmMessage;

      if (llmMessage.includes("RETRIEVE")) {
        const query = llmMessage.split("RETRIEVE")[1]?.trim() ?? "";
        responseMessage = await handleRetrievalAndVerdict(query, messages, MODEL_NAME, OPENROUTER_API_KEY, false);
        messages.push({ role: "assistant", content: responseMessage });
      }

      saveMessages(sessionId, messages);
      return res.json({ message: responseMessage });

    } catch (fallbackError) {
      console.warn("Falling back to Gemini due to OpenRouter error:", fallbackError.message);

      const geminiPrompt = formatGeminiMessages([
        { role: "system", content: personality_questions_prompt },
        ...messages
      ]);

      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
        geminiPrompt,
        { headers: { "Content-Type": "application/json" } }
      );

      const geminiReply = geminiResp.data.candidates[0]?.content?.parts[0]?.text.trim() ?? "[No response from Gemini]";
      messages.push({ role: "assistant", content: geminiReply });

      let responseMessage = geminiReply;

      if (geminiReply.includes("RETRIEVE")) {
        const query = geminiReply.split("RETRIEVE")[1]?.trim() ?? "";
        responseMessage = await handleRetrievalAndVerdict(query, messages, null, GEMINI_API_KEY, true);
        messages.push({ role: "assistant", content: responseMessage });
      }

      saveMessages(sessionId, messages);
      return res.json({ message: responseMessage });
    }

  } catch (error) {
    console.error("Unhandled error in knowYourself:", error);
    res.status(500).json({ error: "Failed to process 'know yourself'" });
  }
}
