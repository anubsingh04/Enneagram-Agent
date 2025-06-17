import { ingestUploadedFile } from "./ingestGithubRepo.js";

export async function uploadDocs(req, res) {
  try {
    const { filename, file } = req.body;
    const result = await ingestUploadedFile(file, filename);
    res.json({ message: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process upload docs' });
  }
}