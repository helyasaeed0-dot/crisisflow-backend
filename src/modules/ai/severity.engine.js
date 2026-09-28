const { SEVERITY } = require('../../utils/constants');
const { containsAny } = require('../../utils/text');

// Starting weights for testing - these are NOT official emergency-service rules
const DEFAULT_WEIGHTS = {
  INJURIES: 30,
  FIRE: 30,
  MULTIPLE_VEHICLES: 15,
  BUILDING_COLLAPSE: 40,
  ROAD_BLOCKAGE: 10,
  MULTIPLE_REPORTS: 10,
  TRAPPED: 25,
  LIFE_THREAT: 30,
  HAZARDOUS: 20,
};

// Base points for each category before any factors are added
const CATEGORY_BASE = {
  ACCIDENT: 20,
  FIRE: 25,
  MEDICAL: 25,
  ROAD_BLOCKAGE: 5,
  WATER_LEAKAGE: 5,
  ELECTRICAL_HAZARD: 20,
  BUILDING_EMERGENCY: 25,
  PERSON_IN_DANGER: 35,
  OTHER: 10,
};

const FACTOR_LABELS = {
  INJURIES: 'Injuries reported',
  FIRE: 'Fire involved',
  MULTIPLE_VEHICLES: 'Multiple vehicles involved',
  BUILDING_COLLAPSE: 'Building collapse',
  ROAD_BLOCKAGE: 'Road blocked',
  MULTIPLE_REPORTS: 'Multiple nearby reports',
  TRAPPED: 'People trapped',
  LIFE_THREAT: 'Life-threatening condition',
  HAZARDOUS: 'Hazardous material or explosion risk',
};

// English + Roman Urdu keywords
const FACTOR_KEYWORDS = {
  INJURIES: ['injur', 'hurt', 'bleeding', 'blood', 'wounded', 'zakhmi', 'khoon', 'chot'],
  FIRE: ['fire', 'flame', 'smoke', 'burning', 'aag', 'dhuan', 'dhuwan'],
  MULTIPLE_VEHICLES: ['collision', 'pile-up', 'pileup', 'multiple vehicles', 'two cars', 'three cars', 'cars collided', 'gariyan'],
  BUILDING_COLLAPSE: ['collapse', 'caved in', 'gir gayi', 'gir gaya', 'girgayi', 'mulba'],
  ROAD_BLOCKAGE: ['blocked', 'blockage', 'road closed', 'traffic jam', 'rasta band', 'road band'],
  TRAPPED: ['trapped', 'stuck inside', 'phans', 'phansa', 'phanse'],
  LIFE_THREAT: ['unconscious', 'not breathing', 'heart attack', 'cardiac', 'dying', 'behosh', 'saans nahi', 'sans nahi'],
  HAZARDOUS: ['gas leak', 'explosion', 'blast', 'live wire', 'electrocut', 'chemical', 'cylinder'],
};

// Some categories imply a factor even if the text does not mention it
const CATEGORY_IMPLIED_FACTORS = {
  FIRE: ['FIRE'],
  ROAD_BLOCKAGE: ['ROAD_BLOCKAGE'],
};

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function scoreToSeverity(score) {
  if (score >= 76) return SEVERITY.CRITICAL;
  if (score >= 51) return SEVERITY.HIGH;
  if (score >= 26) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

function higherSeverity(a, b) {
  return (SEVERITY_RANK[a] || 0) >= (SEVERITY_RANK[b] || 0) ? a : b;
}

function detectFactors(category, text) {
  const found = new Set(CATEGORY_IMPLIED_FACTORS[category] || []);
  for (const [factor, keywords] of Object.entries(FACTOR_KEYWORDS)) {
    if (containsAny(text, keywords).length > 0) found.add(factor);
  }
  return [...found];
}

// Transparent, deterministic score: every point has a recorded reason
function calculateSeverity({ category, text = '', reportCount = 1, weights = DEFAULT_WEIGHTS }) {
  const factors = detectFactors(category, text);
  if (reportCount >= 2) factors.push('MULTIPLE_REPORTS');

  const base = CATEGORY_BASE[category] ?? CATEGORY_BASE.OTHER;
  const breakdown = [{ factor: 'CATEGORY_BASE', label: `Base score for ${category}`, points: base }];
  let score = base;

  for (const factor of factors) {
    const points = weights[factor] || 0;
    score += points;
    breakdown.push({ factor, label: FACTOR_LABELS[factor] || factor, points });
  }

  score = Math.min(100, score);
  return { score, severity: scoreToSeverity(score), factors, breakdown };
}

module.exports = {
  calculateSeverity,
  scoreToSeverity,
  higherSeverity,
  DEFAULT_WEIGHTS,
  FACTOR_LABELS,
  SEVERITY_RANK,
};