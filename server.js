import express from 'express';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();


import { askQuery } from './ask_query.js';
import { configureLlm } from './configure_llm.js';
import { knowYourself } from './know_yourself.js';
import { relationshipAdvice, relationshipAdviceConfig } from './relationship_advice.js';
import { uploadDocs } from './upload_docs.js';

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json({ limit: '500mb' }));
app.use(cors());

// Function to load YAML files from the events directory
function loadEventsFromYaml() {
  const events = {};
  const eventsDir = path.join(__dirname, './events');
  if (!fs.existsSync(eventsDir)) {
    console.warn('⚠️ No events directory found.');
    return events;
  }

  fs.readdirSync(eventsDir).forEach(file => {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      const filePath = path.join(eventsDir, file);
      try {
        const eventName = path.basename(file, path.extname(file));
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const eventConfig = yaml.load(fileContents);
        events[eventName] = eventConfig;
      } catch (e) {
        console.error(`Error loading event config from ${file}: ${e.message}`);
      }
    }
  });
  return events;
}

// Load event configurations
const events = loadEventsFromYaml();

// Route setup
app.post('/ask_query', askQuery);
app.post('/configure_llm', configureLlm);
app.post('/know_yourself', knowYourself);
app.post('/relationship_advice_config', relationshipAdviceConfig);
app.post('/relationship_advice', relationshipAdvice);
app.post('/upload_docs', uploadDocs);

// Health check route
app.get('/', (req, res) => {
  res.send('✅ Express server is running!');
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at: http://localhost:${port}`);
});
