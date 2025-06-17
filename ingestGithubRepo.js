import fetch from "node-fetch";
import * as fs from "fs/promises";
import { VectorStore } from "./vectorStore.js";
import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";
import * as path from "path";
import mammoth from "mammoth";
import { parse as htmlParse } from "node-html-parser";

const COMMIT_FILE = path.resolve("./data/last_commit.json");
const REPO_URL_FILE = path.resolve("./data/repo_url.json");

async function saveLastCommit(repo, commitSha) {
  await fs.writeFile(COMMIT_FILE, JSON.stringify({ repo, commit: commitSha }), "utf-8");
}

async function loadLastCommit() {
  try {
    const data = await fs.readFile(COMMIT_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function loadRepoUrl() {
  try {
    const data = await fs.readFile(REPO_URL_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function getLatestCommitSha(owner, repo, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch latest commit SHA: ${res.statusText}`);
  const json = await res.json();
  return json.sha;
}

async function getChangedFiles(owner, repo, baseSha, headSha) {
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch changed files: ${res.statusText}`);
  const json = await res.json();
  const changed = [];
  const deleted = [];

  for (const file of json.files || []) {
    if (file.status === "modified" || file.status === "added") changed.push(file.filename);
    else if (file.status === "removed") deleted.push(file.filename);
  }
  return { changed, deleted };
}

async function extractTextFromPdf(buffer) {
  try {
    const data = await pdfParse(buffer);
    if (data.text && data.text.trim().length > 30) {
      return data.text;
    } else {
      const worker = await createWorker();
      await worker.load();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      const {
        data: { text },
      } = await worker.recognize(buffer);
      await worker.terminate();
      return text;
    }
  } catch (e) {
    return "";
  }
}

async function ingestChangedFiles(repoUrl, branch = "main") {
  console.log("Entering...");
  const parts = repoUrl.replace(/\/$/, "").split("/");
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  const latestSha = await getLatestCommitSha(owner, repo, branch);
  console.log("Got latest sha..");
  const state = await loadLastCommit();
  console.log("Got last commit...");
  if (state.repo === repo && state.commit === latestSha) {
    console.log("No new commit. Skipping ingestion.");
    return;
  }

  const vs = new VectorStore();
  console.log("Created vectorstore..");
  let changedFiles = [];
  let deletedFiles = [];

  if (state.repo === repo && state.commit) {
    console.log("Getting changed files");
    const changes = await getChangedFiles(owner, repo, state.commit, latestSha);
    changedFiles = changes.changed;
    deletedFiles = changes.deleted;
  } else {
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl);
    console.log("Got tree....");
    if (!treeRes.ok) throw new Error(`Failed to fetch repo tree: ${treeRes.statusText}`);
    const treeJson = await treeRes.json();
    changedFiles = treeJson.tree.filter((f) => f.type === "blob").map((f) => f.path);
    console.log("Got changed files...");
    deletedFiles = [];
  }

  for (const filePath of deletedFiles) {
    console.log(`Removing deleted file from vector DB: ${filePath}`);
    await vs.removeDocument(filePath);
  }

  const allowedExts = new Set([".md", ".txt", ".pdf", ".mdx"]);

  for (const filePath of changedFiles) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (!allowedExts.has(ext)) continue;

      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      const contentRes = await fetch(rawUrl);
      console.log("Got content...");
      if (!contentRes.ok) {
        console.log(`Failed to fetch content for: ${filePath} (status ${contentRes.status})`);
        continue;
      }

      let content;
      if (ext === ".pdf") {
        const buffer = await contentRes.buffer();
        content = await extractTextFromPdf(buffer);
      } else {
        content = await contentRes.text();
      }

      if (content.length > 0) {
        console.log(`Re-ingesting file: ${filePath}`);
        await vs.removeDocument(filePath);
        console.log("Done removal...");
        await vs.upsert(filePath, content);
      }
    } catch (e) {
      console.error(`Error processing file ${filePath}:`, e);
    }
  }

  await saveLastCommit(repo, latestSha);
  console.log("Ingestion complete.");
}

async function ingestUploadedFile(file, filename) {
  const ext = path.extname(filename).toLowerCase();
  const buffer = Buffer.from(file, "base64");
  let content = "";

  switch (ext) {
    case ".pdf":
      content = await extractTextFromPdf(buffer);
      break;
    case ".docx":
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
      break;
    case ".txt":
    case ".md":
      content = buffer.toString("utf-8");
      break;
    case ".html":
      const root = htmlParse(buffer.toString("utf-8"));
      content = root.text;
      break;
    default:
      return `Unsupported file type: ${ext}`;
  }

  const vs = new VectorStore();
  const docId = path.basename(filename, path.extname(filename));
  console.log(`[${docId}] Starting ingestion.`);
  const pages = content.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  console.log(`[${docId}] ${pages.length} logical pages found.`);

  for (let i = 0; i < pages.length; i++) {
    const pageContent = pages[i];
    const pageId = `${docId}_page_${i + 1}`;
    vs.upsert(pageId, pageContent);
  }

  return `Document '${filename}' ingested successfully.`;
}

export { ingestChangedFiles, loadRepoUrl, ingestUploadedFile };
