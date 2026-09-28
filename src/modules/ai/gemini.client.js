const config = require('../../config/env');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DISCOVERY_TIMEOUT_MS = 10000;

// Model chosen for this server run (cached after the first lookup)
let resolvedModel = null;

const apiKey = () => config.ai.gemini.apiKey;

function versionOf(name) {
  const match = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

// Asks Google which models this API key can use for text generation
async function listModels() {
  const response = await fetch(`${BASE_URL}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': apiKey() },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Could not list Gemini models (status ${response.status})`);
  }

  const data = await response.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

// Picks the newest stable Flash model, preferring an auto-updating alias
function pickBestModel(names) {
  if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest';

  const unwanted = /preview|exp|tts|image|live|audio|embedding|learnlm|gemma/i;
  const stable = names.filter((n) => n.startsWith('gemini-') && !unwanted.test(n));
  const pool = stable.length ? stable : names;

  const byNewest = (a, b) => versionOf(b) - versionOf(a);
  const flash = pool.filter((n) => /flash/.test(n) && !/lite/.test(n)).sort(byNewest);
  const flashLite = pool.filter((n) => /flash-lite/.test(n)).sort(byNewest);

  return flash[0] || flashLite[0] || null;
}

async function discoverModel() {
  const names = await listModels();
  const model = pickBestModel(names);
  if (!model) throw new Error('No usable Gemini model found for this API key');
  console.log(`Gemini model selected automatically: ${model}`);
  return model;
}

async function getModel() {
  if (resolvedModel) return resolvedModel;

  const configured = config.ai.gemini.model;
  resolvedModel = configured && configured !== 'auto' ? configured : await discoverModel();
  return resolvedModel;
}

function callGenerate(model, body, timeoutMs) {
  return fetch(`${BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Sends a prompt to Gemini and returns the raw text reply.
 * If the current model has been retired (404), it finds a new one and retries once.
 */
async function generateText({ systemPrompt, userPrompt, timeoutMs = 10000 }) {
  if (!apiKey()) return null;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  };

  let model = await getModel();
  let response = await callGenerate(model, body, timeoutMs);

  if (response.status === 404) {
    console.warn(`Gemini model "${model}" is no longer available, looking for a replacement...`);
    resolvedModel = await discoverModel();
    model = resolvedModel;
    response = await callGenerate(model, body, timeoutMs);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini (${model}) responded with status ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  return parts.map((p) => p.text || '').join('');
}

module.exports = { generateText };