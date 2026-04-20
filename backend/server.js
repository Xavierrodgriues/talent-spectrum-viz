import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("FATAL ERROR: MONGO_URI is missing in .env");
  process.exit(1);
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('jobs_data');
    console.log("Connected to MongoDB (jobs_data)");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

connectDB();

function cleanJobDescription(text) {
  if (!text) return "";
  let cleaned = text.replace(/<[^>]*>?/gm, ' '); // Remove HTML tags
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, ' '); // Remove URLs
  cleaned = cleaned.replace(/[\w.-]+@[\w.-]+\.\w+/g, ' '); // Remove emails
  cleaned = cleaned.replace(/[^\w\s.,;:()/'"-]/g, ' '); // Remove weird special chars
  cleaned = cleaned.replace(/\n+/g, '\n'); // Normalize newlines
  cleaned = cleaned.replace(/\s{2,}/g, ' '); // Remove multiple spaces
  return cleaned.trim();
}

app.post('/api/role-info', async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ error: "Role is required in request body" });
    }

    console.log(`Fetching info for role: ${role}`);
    const collection = db.collection('jobs_details');

    // Search job_title using case-insensitive regex
    // Fetch only 3-5 matching documents
    const jobs = await collection.find({ job_title: { $regex: role, $options: 'i' } }).limit(5).toArray();

    if (jobs.length === 0) {
      return res.status(404).json({ error: "no role found" });
    }

    // Extract and clean job_description
    const descriptions = jobs.map(job => cleanJobDescription(job.job_description)).join("\n\n---\n\n");

    // Trim to ~3000-4000 characters
    let combinedDescription = descriptions;
    const MAX_CHARS = 3500;
    if (combinedDescription.length > MAX_CHARS) {
      combinedDescription = combinedDescription.substring(0, MAX_CHARS) + "...";
    }

    // Structured prompt to ensure JSON output
    //     const prompt = `
    // Analyze the following job descriptions for the role of "${role}" and extract the information requested.
    // Please return the result *only* as a valid JSON object matching the format below. Do not include any explanations, introduction, markdown blocks, or other text outside the JSON.

    // Expected JSON format:
    // {
    //   "top_skills": ["skill1", "skill2", "skill3"],
    //   "common_responsibilities": ["resp1", "resp2", "resp3"],
    //   "resume_bullets": ["bullet1", "bullet2"]
    // }

    // Job Descriptions Text:
    // ${combinedDescription}
    // `;

    const prompt = `
      You are a strict JSON generator.

      Analyze the following job descriptions for the role "${role}".

      Return ONLY valid JSON. No text before or after.

      Format:
      {
        "top_skills": [],
        "common_responsibilities": [],
        "resume_bullets": []
      }

      Rules:
      - max 5 skills
      - exactly 10 responsibilities
      - exactly 2 resume bullets
      - short and precise

      Job Descriptions:
      ${combinedDescription}
      `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100000);

    // Send to Ollama (Mistral locally)
    const ollamaResponse = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'mistral',
        prompt: prompt,
        stream: false,
        format: 'json' // Hint to Ollama to output standard JSON
      })
    });

    clearTimeout(timeout);

    if (!ollamaResponse.ok) {
      throw new Error(`Ollama request failed: ${ollamaResponse.statusText}`);
    }

    const data = await ollamaResponse.json();
    let resultJson;

    try {
      resultJson = JSON.parse(data.response);
    } catch (e) {
      console.warn("Failed to parse JSON directly from model, returning raw response");
      resultJson = { raw: data.response };
    }

    console.log(`Successfully generated info for role: ${role}`);
    res.json(resultJson);

  } catch (error) {
    console.error("Error processing role info:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Backend REST API running on http://localhost:${port}`);
  console.log(`POST /api/role-info with { "role": "Desired Role" } to trigger`);
});
