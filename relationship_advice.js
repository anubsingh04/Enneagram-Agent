import axios from "axios";
import fs from "fs";
import path from "path";
import { VectorStore } from "./vectorStore.js";
import { relationship_advice_system_prompt, relationship_advice_system_prompt_verdict } from "./system_prompts_archive.js";
import { fileURLToPath } from "url";

// Fix for ES Modules (__dirname replacement)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function handleRelationshipAdvice(req, res, isConfig) {
  try {
    const {
      session_id = '',
      user_enegram_type = '',
      partner_enegram_type = '',
      relationship_type = '',
      add_relationship_comment = '',
      user_query = ''
    } = req.body;

    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    const CONVO_DIR = path.resolve(__dirname, "./conversations/Relationships");

    if (!fs.existsSync(CONVO_DIR)) {
      fs.mkdirSync(CONVO_DIR, { recursive: true });
    }

    const getSessionFile = (sessionId) => path.join(CONVO_DIR, `${sessionId}.json`);

    const loadMessages = (sessionId) => {
      const file = getSessionFile(sessionId);
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
      }
      return [];
    };

    const saveMessages = (sessionId, messages) => {
      fs.writeFileSync(getSessionFile(sessionId), JSON.stringify(messages, null, 2));
    };

    const formatGeminiMessages = (messages) => ({
      contents: [
        {
          parts: messages.map(m => ({ text: `${m.role === "user" ? "User" : m.role === "tool" ? "Tool" : "Assistant"}: ${m.content}` }))
        }
      ]
    });

    const messages = loadMessages(session_id);

    // Configuration Stage
    if (isConfig || user_query.length === 0) {
      // const vs = new VectorStore();
      // const contextQuery = `Enneagram Types: ${user_enegram_type}, ${partner_enegram_type}`;
      // const docs = await vs.search(contextQuery);
      // const uniqueDocs = Array.from(new Set(docs.map(doc => doc.content)));
      // const eneagramContext = uniqueDocs.join('\n');

      const userInput = `
Here are the details given by the user about their enneagram types and relationship dynamics:
- User's Enneagram Type: ${user_enegram_type}
- Partner's Enneagram Type: ${partner_enegram_type}
- Relationship Type: ${relationship_type}
- Additional Insights: ${add_relationship_comment || "None"}
      `.trim();

      messages.push({ role: "user", content: userInput });
      // messages.push({ role: "tool", content: eneagramContext });

      saveMessages(session_id, messages);
      return res.json({ message: "User information has been stored successfully." });
    }

    // Advice stage
    messages.push({ role: "user", content: user_query });

    let responseMessage = "";

    try {
      const llmResp = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: process.env.MODEL_NAME,
          messages: [
            { role: "system", content: relationship_advice_system_prompt },
            ...messages
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const llmMessage = llmResp.data.choices[0].message.content.trim();
      messages.push({ role: "assistant", content: llmMessage });

      const isRetrieval = llmMessage.includes("RETRIEVE");

      if (isRetrieval) {
        const query = llmMessage.split("RETRIEVE")[1]?.trim() || "";
        const vs = new VectorStore();
        const docs = await vs.search(query);
        const uniqueDocs = Array.from(new Set(docs.map(doc => doc.content)));
        const context = uniqueDocs.join('\n');
        messages.push({ role: "tool", content: context });

        const verdictResp = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: process.env.MODEL_NAME,
            messages: [
              { role: "system", content: relationship_advice_system_prompt_verdict },
              ...messages
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );

        responseMessage = verdictResp.data.choices[0].message.content.trim();
        messages.push({ role: "assistant", content: responseMessage });
      } else {
        responseMessage = llmMessage;
      }
    } catch (error) {
      // Gemini fallback
      const prompt = formatGeminiMessages([
        { role: "system", content: relationship_advice_system_prompt },
        ...messages
      ]);

      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
        prompt,
        {
          headers: { "Content-Type": "application/json" }
        }
      );

      const geminiReply = geminiResp.data.candidates[0].content.parts[0].text.trim();
      messages.push({ role: "assistant", content: geminiReply });

      const isRetrieval = geminiReply.includes("RETRIEVE");

      if (isRetrieval) {
        const query = geminiReply.split("RETRIEVE")[1]?.trim() || "";
        const vs = new VectorStore();
        const docs = await vs.search(query);
        const uniqueDocs = Array.from(new Set(docs.map(doc => doc.content)));
        const context = uniqueDocs.join('\n');
        messages.push({ role: "tool", content: context });

        const verdictPrompt = formatGeminiMessages([
          { role: "system", content: relationship_advice_system_prompt_verdict },
          ...messages
        ]);

        const verdictResp = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
          verdictPrompt,
          {
            headers: { "Content-Type": "application/json" }
          }
        );

        responseMessage = verdictResp.data.candidates[0].content.parts[0].text.trim();
        messages.push({ role: "assistant", content: responseMessage });
      } else {
        responseMessage = geminiReply;
      }
    }

    saveMessages(session_id, messages);
    return res.json({ message: responseMessage });

  } catch (error) {
    console.error("handleRelationshipAdvice error:", error);
    return res.status(500).json({ error: "Failed to process relationship advice." });
  }
}

// Exported API routes
export async function relationshipAdvice(req, res) {
  return handleRelationshipAdvice(req, res, false);
}

export async function relationshipAdviceConfig(req, res) {
  return handleRelationshipAdvice(req, res, true);
}
