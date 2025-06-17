import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Simulate __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function configureLlm(req, res) {
  try {
    const { apiKey, model } = req.body;
    if (!apiKey || !model) {
      return res.status(400).json({ error: "apiKey and model are required" });
    }

    const envPath = path.resolve(__dirname, "./.env");
    let envContent = "";

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    const envLines = envContent.split("\n").filter(Boolean);
    const envMap = new Map(envLines.map(line => line.split("=")));

    envMap.set("OPENROUTER_API_KEY", apiKey);
    envMap.set("MODEL_NAME", model);

    const updatedContent = Array.from(envMap.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    fs.writeFileSync(envPath, updatedContent + "\n");

    res.json({ message: "LLM configuration updated successfully." });
  } catch (error) {
    console.error("Error updating .env:", error);
    res.status(500).json({ error: "Failed to configure LLM" });
  }
}
