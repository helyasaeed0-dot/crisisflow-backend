const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'there', 'this', 'that', 'near', 'from',
  'have', 'has', 'was', 'were', 'are', 'hai', 'hain', 'aur', 'par',
  'mein', 'main', 'bhi', 'yahan', 'wahan',
]);

const normalize = (text = '') => String(text || '').toLowerCase();

function tokenize(text = '') {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// Word-overlap similarity between two texts (0 to 1)
function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// Returns the keywords from the list that appear in the text
function containsAny(text, keywords) {
  const t = normalize(text);
  return keywords.filter((k) => t.includes(k));
}

module.exports = { tokenize, jaccardSimilarity, containsAny };