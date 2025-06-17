import pkg from 'faiss-node';
const { IndexFlatL2 } = pkg;
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Loaded @langchain/google-genai");

export class VectorStore {
  constructor(
    indexPath = path.resolve(__dirname, './index/index.faiss'),
    metaPath = path.resolve(__dirname, './index/metadata.json'),
    docIdMapPath = path.resolve(__dirname, './index/docIdMap.json')
  ) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in .env');

    this.indexPath = indexPath;
    this.metaPath = metaPath;
    this.docIdMapPath = docIdMapPath;
    this.metadata = {};
    this.docIdByVectorIdx = [];

    this.model = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      modelName: 'models/embedding-001'
    });

    const dim = 768;
    if (fs.existsSync(this.indexPath)) {
      this.index = IndexFlatL2.read(this.indexPath);
    } else {
      this.index = new IndexFlatL2(dim);
    }

    if (fs.existsSync(this.metaPath)) {
      this.metadata = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
    }

    if (fs.existsSync(this.docIdMapPath)) {
      this.docIdByVectorIdx = JSON.parse(fs.readFileSync(this.docIdMapPath, 'utf-8'));
    }
  }

  async upsert(docId, content) {
    const chunks = this.chunkText(content);
    console.log("Creating chunks...");
    const embeddings = await this.model.embedDocuments(chunks);
    console.log("Creating embeddings...");
    const flatEmbeddings = embeddings.flat();
    this.index.add(flatEmbeddings);
    for (let i = 0; i < embeddings.length; i++) {
      this.docIdByVectorIdx.push(docId);
    }
    this.metadata[docId] = { content };
    this.save();
    console.log(`[${docId}] Upserted successfully.`);
  }

  async search(query, k = 5) {
    const queryVec = await this.model.embedQuery(query);
    const result = this.index.search(queryVec, k);
    console.log(result);
    const hits = [];
    for (let i = 0; i < result.labels.length; i++) {
      const idx = result.labels[i];
      const docId = this.docIdByVectorIdx[idx];
      if (docId && this.metadata[docId]) {
        hits.push({
          docId: docId,
          content: this.metadata[docId].content
        });
      }
    }
    return hits;
  }

  async removeDocument(docId) {
    if (!(docId in this.metadata)) {
      console.log(`[${docId}] Not found in index. Skipping removal.`);
      return;
    }

    const indicesToRemove = [];
    for (let i = 0; i < this.docIdByVectorIdx.length; i++) {
      if (this.docIdByVectorIdx[i] === docId) {
        indicesToRemove.push(i);
      }
    }

    if (indicesToRemove.length === 0) {
      console.log(`[${docId}] No associated vectors found. Only metadata removed.`);
      delete this.metadata[docId];
      this.save();
      return;
    }

    const removedCount = this.index.removeIds(indicesToRemove);
    console.log(`[${docId}] Removed ${removedCount} vectors from FAISS index.`);

    delete this.metadata[docId];

    const removalSet = new Set(indicesToRemove);
    this.docIdByVectorIdx = this.docIdByVectorIdx.filter((_, idx) => !removalSet.has(idx));

    this.save();
    console.log(`[${docId}] Document fully removed and index state updated.`);
  }

  chunkText(text, maxTokens = 500, overlap = 100) {
    const words = text.split(/\s+/);
    const chunks = [];
    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + maxTokens, words.length);
      chunks.push(words.slice(start, end).join(' '));
      start += maxTokens - overlap;
    }
    return chunks;
  }

  ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  save() {
    console.log("Saving vector store...");
    try {
      this.ensureDir(this.indexPath);
      this.index.write(this.indexPath);
    } catch (err) {
      console.error("Failed to write index:", err);
    }

    try {
      this.ensureDir(this.metaPath);
      fs.writeFileSync(this.metaPath, JSON.stringify(this.metadata, null, 2));
    } catch (err) {
      console.error("Failed to write metadata:", err);
    }

    try {
      this.ensureDir(this.docIdMapPath);
      fs.writeFileSync(this.docIdMapPath, JSON.stringify(this.docIdByVectorIdx, null, 2));
    } catch (err) {
      console.error("Failed to write docId map:", err);
    }

    console.log("Save complete.");
  }
}
