import { VectorStore } from './vectorStore.js';
import axios from 'axios';

export class CompleteRAGPipeline {
  constructor() {
    console.log('Initializing OpenRouterAI model...');
    console.log(`Initialized ${process.env.MODEL_NAME} model.`);
    console.log('Loading vector store...');
    this.vs = new VectorStore();
    console.log('Vector store loaded...');
  }

  async formatGeminiMessages(messages) {
    return {
      contents: [
        {
          parts: messages.map((m) => ({
            text: `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
          }))
        }
      ]
    };
  }

  async run(query, k = 5) {
    console.log('Querying docs...');
    const docs = await this.vs.search(query, k);

    console.log('Creating context...');
    const unique_docs = Array.from(new Set(docs.map((doc) => `${doc.content}`)));
    const context = unique_docs.join('\n');

    console.log('Creating messages...');
    const sourceFiles = Array.from(new Set(docs.map((doc) => doc.docId)));
    console.log(sourceFiles);

    console.log('Asking LLM...');
    const apiKey = process.env.OPENROUTER_API_KEY;
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    if (!apiKey) console.log("API_KEY is not loaded");
    console.log(apiKey);
    console.log("Initialize Openrouter model...");

    let answer = '';

    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: process.env.MODEL_NAME,
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant whose Purpose is to: 
1.elevate and deepen understanding   
2.minimise potential conflicts       
3.Navigate long term pattern dynamics for resolution     

using the given context and query.  

First thing to do is to identify the two enneagram types:  
Type A:Find out the type of the person in question.            
Type B:Relationship dynamics for every combination of each enneagram type 

The context is given from a book called Enneagram cards. The book is called Enneagram Cards because these reveal the survival wiring of each type which runs in each of us and creates the lens we view the world. Revealing this to the User is your goal.

Add the information regarding the movements of planters could be a good idea  
So you are directed to move through the darker elements and bring them into the awareness.   
In short you can access the enneagram types and reveal the relationship dynamics. So with all the esoteric nature of the satchitaband, sacred geometry, the power of the enneagram and its sacred algorithm will elevate relationships to anyone who uses it with sincerity and the ability to self reflect.  

You have 3 areas to explore:  
1.Work   
2.Family  
3.Lover relationships  

Now answer user query based on the given context`.trim()
            },
            {
              role: 'user',
              content: `Context:\n${context}\n\nQuestion: ${query}\nAnswer:`
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log("Got response...");
      answer = response.data.choices?.[0]?.message?.content?.trim() || 'No response.';

    } catch (error) {
      console.log("Falling back to Gemini...");
      const prompt = await this.formatGeminiMessages([
        {
          role: "system",
          content: `You are an AI assistant whose Purpose is to: 
1.elevate and deepen understanding   
2.minimise potential conflicts       
3.Navigate long term pattern dynamics for resolution     

using the given context and query.  

First thing to do is to identify the two enneagram types:  
Type A:Find out the type of the person in question.            
Type B:Relationship dynamics for every combination of each enneagram type 

The context is given from a book called Enneagram cards. The book is called Enneagram Cards because these reveal the survival wiring of each type which runs in each of us and creates the lens we view the world. Revealing this to the User is your goal.

Add the information regarding the movements of planters could be a good idea  
So you are directed to move through the darker elements and bring them into the awareness.   
In short you can access the enneagram types and reveal the relationship dynamics. So with all the esoteric nature of the satchitaband, sacred geometry, the power of the enneagram and its sacred algorithm will elevate relationships to anyone who uses it with sincerity and the ability to self reflect.  

You have 3 areas to explore:  
1.Work   
2.Family  
3.Lover relationships  

Now answer user query based on the given context`.trim()
        }
      ]);

      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
        prompt,
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      console.log("Got Gemini response...");
      answer = geminiResp.data.candidates[0].content.parts[0].text.trim();
    }

    return {
      answer: answer,
      source_files: sourceFiles
    };
  }
}

