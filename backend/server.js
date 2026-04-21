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

// ─── JS-side experience matcher (handles all DB formats) ───────────────────
// DB experience can be: null, "3", "3 years", "3+", "3+ years", "3-5", "3-5 years"
function matchesExperience(expStr, userYears) {
  if (userYears === null) return true;   // no filter requested
  if (!expStr) return true;              // null in DB = no requirement, always include

  // Extract all numbers from the string (e.g. "3-5 years" → [3, 5])
  const nums = [...expStr.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
  if (nums.length === 0) return true;    // unparseable → include to be safe

  const raw = expStr.trim();

  // Range: "3-5" or "3-5 years"
  if (nums.length >= 2 && /^\d+\s*-\s*\d+/.test(raw)) {
    return userYears >= nums[0] && userYears <= nums[1];
  }

  // Open-ended: "3+" or "3+ years"
  if (/\+/.test(raw)) {
    return userYears >= nums[0];
  }

  // Exact: "3" or "3 years"
  return userYears === nums[0];
}
// ────────────────────────────────────────────────────────────────────────────

// ─── TEST ENDPOINT (No LLM) ───────────────────────────────────────────────────
// POST /api/search-jobs  Body: { "role": "DevOps Engineer", "years": 7 }
app.post('/api/search-jobs', async (req, res) => {
  try {
    const { role, years } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });

    const userYears = (years !== undefined && years !== '' && !isNaN(Number(years)))
      ? Number(years)
      : null;

    const collection = db.collection('indeed_job_details');

    // 1. Fetch all docs matching the title (simple regex, no $expr)
    const titleMatches = await collection
      .find({ title: { $regex: role, $options: 'i' } })
      .toArray();

    // 2. Filter experience in JavaScript
    const jobs = titleMatches.filter(j => matchesExperience(j.experience, userYears));

    return res.json({
      role,
      years: userYears,
      total_title_matches: titleMatches.length,
      total_after_experience_filter: jobs.length,
      jobs: jobs.map(j => ({
        job_id: j.job_id,
        title: j.title,
        experience: j.experience,
        scraped_at: j.scraped_at,
        description_preview: j.job_description?.substring(0, 200) + '...'
      }))
    });
  } catch (err) {
    console.error('search-jobs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/role-info', async (req, res) => {
  try {
    const { role, years } = req.body;
    if (!role) {
      return res.status(400).json({ error: "Role is required in request body" });
    }

    const userYears = (years !== undefined && years !== '' && !isNaN(Number(years)))
      ? Number(years)
      : null;

    console.log(`Fetching info for role: "${role}" | experience: ${userYears ?? 'not specified'}`);
    const collection = db.collection('indeed_job_details');

    // 1. Fetch all docs matching the title
    const titleMatches = await collection
      .find({ title: { $regex: role, $options: 'i' } })
      .toArray();

    // 2. Filter experience in JavaScript using shared matchesExperience()
    const jobs = titleMatches.filter(j => matchesExperience(j.experience, userYears));

    if (jobs.length === 0) {
      if (titleMatches.length > 0 && userYears !== null) {
        return res.status(404).json({
          error: `No job listings found for "${role}" with ${userYears} year(s) of experience. Try adjusting the experience or check back later.`
        });
      }
      return res.status(404).json({ error: `No role found for "${role}" in our database.` });
    }

    console.log(`Found ${jobs.length} matching job(s) for "${role}" (experience filter: ${userYears ?? 'none'} | title matches: ${titleMatches.length})`);

    // Extract and clean ALL matched job descriptions
    const descriptions = jobs
      .map(job => cleanJobDescription(job.job_description))
      .filter(Boolean)
      .join("\n\n---\n\n");

    // Cap to ~8000 chars to stay within LLM context window, but capture more signal from multiple JDs
    let combinedDescription = descriptions;
    const MAX_CHARS = 8000;
    if (combinedDescription.length > MAX_CHARS) {
      combinedDescription = combinedDescription.substring(0, MAX_CHARS) + "...";
    }

    console.log(`Sending ${combinedDescription.length} chars from ${jobs.length} JD(s) to LLM.`);

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

    // const prompt = `
    //   You are an expert tech recruiter and a strict JSON generator.

    //   Analyze ONLY the following job descriptions for the role "${role}".
    //   Your goal is to extract market requirements strictly based on the provided text, and present them in a way that helps a candidate understand *why* the market wants them, so they can align their resume experience section to it.

    //   Return ONLY valid JSON. No text before or after.

    //   Format:
    //   {
    //     "top_skills": [],
    //     "common_responsibilities": [],
    //     "resume_bullets": []
    //   }

    //   Rules:
    //   - "top_skills": max 5 skills.
    //   - "common_responsibilities": exactly 10 responsibilities. Write these as actionable recruiter advice explaining *why* the market needs it (e.g., "Employers highly value multi-cloud flexibility—highlight your experience managing cloud infrastructure across platforms.").
    //   - "resume_bullets": exactly 2 resume bullets. Write strong, quantifiable achievements the user can adapt.
    //   - Keep it insightful but concise. Do not include random company perks (e.g., "hybrid", "dental", "Tampa").

    //   Job Descriptions:
    //   ${combinedDescription}
    //   `;

    const prompt = `
          You are an expert tech recruiter and strict JSON generator.

          Analyze the following job descriptions for the role "${role}".

          Candidate experience: ${userYears !== null ? userYears + " years" : "not specified"}.

          Your task:
          Generate feedback based on BOTH:
          1. Market expectations (from job descriptions)
          2. Candidate experience level

          IMPORTANT EXPERIENCE RULES:

          - 0–2 years:
            Use tone: learning, assisting, supporting
            Avoid: "design", "architect", "lead", "expert", "mastery"

          - 3–5 years:
            Use tone: implementing, building, working independently
            Avoid: "enterprise-wide ownership", "deep expertise"

          - 6–8 years:
            Use tone: designing, optimizing, owning systems

          - 9+ years:
            Use tone: architecting, leading, scaling systems

          Return ONLY valid JSON.

          Format:
          {
            "top_skills": [],
            "common_responsibilities": [],
            "resume_bullets": []
          }

          Rules:
          - top_skills: max 5
          - common_responsibilities: exactly 10
          - Adjust complexity based on experience level
          - resume_bullets: exactly 2 (match experience level)

          Job Descriptions:
          ${combinedDescription}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100000);

    // Send to Ollama (gemma4:e4b locally)
    const ollamaResponse = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gemma4:e4b',
        prompt: prompt,
        stream: false,
        format: 'json', // Hint to Ollama to output standard JSON
        options: {
          temperature: 0.3 // Higher temperature adds creativity/variation
        }
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
