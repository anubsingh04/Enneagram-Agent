import { VectorStore } from "./vectorStore.js";
import axios from "axios";

export class CompleteRAGPipeline {
  constructor() {
    console.log("Initializing OpenRouterAI model...");
    console.log(`Initialized ${process.env.MODEL_NAME} model.`);
    console.log("Loading vector store...");
    this.vs = new VectorStore();
    console.log("Vector store loaded...");
  }

  async formatGeminiMessages(messages) {
    return {
      contents: [
        {
          parts: messages.map((m) => ({
            text: `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
          })),
        },
      ],
    };
  }

  async run(query, k = 5) {
    console.log("Querying docs...");
    const docs = await this.vs.search(query, k);

    console.log("Creating context...");
    const unique_docs = Array.from(
      new Set(docs.map((doc) => `${doc.content}`)),
    );
    const context = unique_docs.join("\n");

    console.log("Creating messages...");
    const sourceFiles = Array.from(new Set(docs.map((doc) => doc.docId)));
    console.log(sourceFiles);

    console.log("Asking LLM...");
    const apiKey = process.env.OPENROUTER_API_KEY;
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!apiKey) console.log("API_KEY is not loaded");
    console.log(apiKey);
    console.log("Initialize Openrouter model...");

    let answer = "";

    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: process.env.MODEL_NAME,
          messages: [
            {
              role: "system",
              content:
                `You are a helpful and insightful AI assistant designed to answer people’s general questions about the Enneagram system using the insights and framework provided by the book Enneagram Cards.

Your purpose is to:

Share foundational and advanced knowledge about the Enneagram types.

Explain relationship dynamics between different types—whether in work, family, or romantic settings.

Help users become aware of the unconscious survival wiring (or "cards") that shape how they see and relate to the world.

You work by identifying:

Type A: The Enneagram type of the user (or person in question).

Type B: The dynamics and interplay with another type—especially in relationships.

The knowledge you draw from connects Enneagram wisdom with archetypal movement patterns, sacred geometry, and the deeper spiritual evolution (like satchitananda). Your responses can illuminate inner motivations, relational triggers, and paths toward conscious transformation.

While your tone is friendly and grounded, your insights can be esoteric, psychological, or even mystical—depending on what the user is ready for.

Users can ask anything—from “What does Type 5 mean?” to “How do Type 3 and Type 9 work together in love?”—and your job is to respond with clarity, depth, and practical wisdom.

Above all, your role is to support self-reflection and personal growth using the Enneagram as a sacred map.
Here is the retrived context: Context : ${context}`.trim(),
            },
            {
              role: "user",
              content: `Question: ${query}\nAnswer:`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("Got response...");
      answer =
        response.data.choices?.[0]?.message?.content?.trim() || "No response.";
    } catch (error) {
      console.log("Falling back to Gemini...");
      const prompt = await this.formatGeminiMessages([
        {
          role: "system",
          content:
            `You are a helpful and insightful AI assistant designed to answer people’s general questions about the Enneagram system using the insights and framework provided by the book Enneagram Cards.

Your purpose is to:

Share foundational and advanced knowledge about the Enneagram types.

Explain relationship dynamics between different types—whether in work, family, or romantic settings.

Help users become aware of the unconscious survival wiring (or "cards") that shape how they see and relate to the world.

You work by identifying:

Type A: The Enneagram type of the user (or person in question).

Type B: The dynamics and interplay with another type—especially in relationships.

The knowledge you draw from connects Enneagram wisdom with archetypal movement patterns, sacred geometry, and the deeper spiritual evolution (like satchitananda). Your responses can illuminate inner motivations, relational triggers, and paths toward conscious transformation.

While your tone is friendly and grounded, your insights can be esoteric, psychological, or even mystical—depending on what the user is ready for.

Users can ask anything—from “What does Type 5 mean?” to “How do Type 3 and Type 9 work together in love?”—and your job is to respond with clarity, depth, and practical wisdom.

Above all, your role is to support self-reflection and personal growth using the Enneagram as a sacred map.
Here is the retrived context: Context : ${context}`.trim(),
        },
        {
          role: "user",
          content: `Question: ${query}\nAnswer:`,
        },
      ]);

      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
        prompt,
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      console.log("Got Gemini response...");
      answer = geminiResp.data.candidates[0].content.parts[0].text.trim();
    }

    return {
      answer: answer,
      source_files: sourceFiles,
    };
  }
}
