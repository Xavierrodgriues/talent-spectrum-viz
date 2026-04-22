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

// ─── CHUNK TEXT ───────────────────────────────────────────────────────────────
// Splits a large string into ~CHUNK_SIZE character chunks without breaking words.
const CHUNK_SIZE = 8000;  // Medium chunks — balance between fewer calls and timeout risk
const MAX_JOBS   = 5;     // Keep input small so each chunk finishes within timeout

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      // Walk back to the nearest whitespace so we don't cut mid-word
      while (end > start && !/\s/.test(text[end])) end--;
      if (end === start) end = start + CHUNK_SIZE; // safety: no whitespace found
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(c => c.length > 0);
}
// ────────────────────────────────────────────────────────────────────────────

// ─── MERGE CHUNK RESULTS ────────────────────────────────────────────────────
// Merges the JSON output from multiple LLM chunk calls into one final result.
function mergeResults(results) {
  const skillFreq = {};
  const allResponsibilities = [];
  const allBullets = [];

  for (const r of results) {
    if (!r || typeof r !== 'object') continue;

    // Count skill frequency across chunks
    if (Array.isArray(r.top_skills)) {
      for (const skill of r.top_skills) {
        const key = skill.trim().toLowerCase();
        skillFreq[key] = (skillFreq[key] || { label: skill.trim(), count: 0 });
        skillFreq[key].count++;
      }
    }

    // Collect all responsibilities
    if (Array.isArray(r.common_responsibilities)) {
      for (const resp of r.common_responsibilities) {
        const normalized = resp.trim();
        if (normalized) allResponsibilities.push(normalized);
      }
    }

    // Collect all resume bullets
    if (Array.isArray(r.resume_bullets)) {
      for (const bullet of r.resume_bullets) {
        const normalized = bullet.trim();
        if (normalized) allBullets.push(normalized);
      }
    }
  }

  // Top 5 skills by frequency
  const topSkills = Object.values(skillFreq)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(s => s.label);

  // Deduplicate responsibilities, keep top 10
  const seenResp = new Set();
  const uniqueResponsibilities = [];
  for (const r of allResponsibilities) {
    const key = r.toLowerCase().slice(0, 60); // compare on first 60 chars
    if (!seenResp.has(key)) {
      seenResp.add(key);
      uniqueResponsibilities.push(r);
    }
    if (uniqueResponsibilities.length === 10) break;
  }

  // Prioritise bullets that contain numbers (quantified achievements), pick 2
  const quantified = allBullets.filter(b => /\d/.test(b));
  const nonQuantified = allBullets.filter(b => !/\d/.test(b));
  const bestBullets = [...quantified, ...nonQuantified].slice(0, 2);

  return {
    top_skills: topSkills,
    common_responsibilities: uniqueResponsibilities,
    resume_bullets: bestBullets,
  };
}
// ────────────────────────────────────────────────────────────────────────────

// ─── SINGLE OLLAMA CALL ─────────────────────────────────────────────────────
// NOTE: Ollama processes one request at a time — parallel calls just queue up
// and compete for the GPU, causing timeouts. Always call sequentially.
async function callLLM(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 180s per chunk
  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gemma4:e4b',
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.3 },
      })
    });
    if (!response.ok) throw new Error(`Ollama request failed: ${response.statusText}`);
    const data = await response.json();
    try {
      return JSON.parse(data.response);
    } catch {
      console.warn('Chunk JSON parse failed — storing raw output');
      return null;
    }
  } finally {
    clearTimeout(timeout);
  }
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
    const keywords = role.split(" ");
    const titleMatches = await collection.find({
      $and: keywords.map(word => ({
        title: { $regex: word, $options: 'i' }
      }))
    }).toArray();

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
    const keywords = role.split(" ");
    const titleMatches = await collection.find({
      $and: keywords.map(word => ({
        title: { $regex: word, $options: 'i' }
      }))
    }).toArray();

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

    // ── Cap jobs to MAX_JOBS to keep LLM input manageable ──────────────────
    const cappedJobs = jobs.slice(0, MAX_JOBS);
    console.log(`Using ${cappedJobs.length} job(s) (capped from ${jobs.length}) for LLM analysis`);

    // ── Build full combined text ────────────────────────────────────────────
    const fullText = cappedJobs
      .map(job => cleanJobDescription(job.job_description))
      .filter(Boolean)
      .join('\n\n---\n\n');

    // ── Split into word-safe chunks ─────────────────────────────────────────
    const chunks = chunkText(fullText);
    console.log(`Total text: ${fullText.length} chars | Split into ${chunks.length} chunk(s)`);

    // ── Build the shared prompt template ───────────────────────────────────
    const buildPrompt = (chunkText) => `
      You are an expert tech recruiter and strict JSON generator.

      Analyze the following job descriptions for the role "${role}".

      Candidate experience: ${userYears !== null ? userYears + ' years' : 'not specified'}.

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
      - common_responsibilities: exactly 10. These MUST be framed as "Roles and Responsibilities" — professional, actionable duties the candidate should demonstrate (e.g., "Design and implement scalable microservices using Node.js").
      - Adjust complexity and tone based on the experience level rules above.
      - resume_bullets: exactly 2. Provide strong, quantifiable bullet points the candidate can add to their resume.

      Job Descriptions:
      ${chunkText}
    `;

    // ── Process chunks sequentially (Ollama = single-threaded GPU) ───────────
    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
      const result = await callLLM(buildPrompt(chunks[i]));
      chunkResults.push(result);
    }

    // ── Merge all chunk results into one final response ─────────────────────
    const merged = mergeResults(chunkResults);
    console.log(`Successfully merged ${chunks.length} chunk(s) for role: ${role}`);
    res.json(merged);

  } catch (error) {
    console.error('Error processing role info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Backend REST API running on http://localhost:${port}`);
  console.log(`POST /api/role-info with { "role": "Desired Role" } to trigger`);
});
