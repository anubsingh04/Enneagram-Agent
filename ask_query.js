import { CompleteRAGPipeline } from "./ragPipeline.js";

export async function askQuery(req, res) {
  try {
    console.log("Got Request")
    const query = req.body.query;
    const rag = new CompleteRAGPipeline();
    const result = await rag.run(query);
    res.json({ answer: result.answer, sources: result.source_files });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process query' });
  }
}