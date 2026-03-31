'use strict';

// Simple math-driven intent detector using TF-IDF + cosine similarity.
// - buildModel(intents): intents = { intentName: [example phrases...] }
// - detectIntent(model, query): returns { intent, score, scores }

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\p{P}$+<=>^`|~]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildModel(intents) {
  const docs = []; // { intent, tokens }
  for (const intent of Object.keys(intents)) {
    const examples = intents[intent] || [];
    for (const ex of examples) {
      const tokens = tokenize(ex);
      docs.push({ intent, tokens });
    }
  }

  const N = docs.length || 1;
  const df = Object.create(null);
  const vocab = Object.create(null);

  // document frequencies
  for (const d of docs) {
    const seen = new Set();
    for (const t of d.tokens) {
      vocab[t] = true;
      if (!seen.has(t)) {
        df[t] = (df[t] || 0) + 1;
        seen.add(t);
      }
    }
  }

  const idf = Object.create(null);
  for (const t of Object.keys(vocab)) idf[t] = Math.log((N + 1) / (1 + (df[t] || 0))) + 1;

  // tf-idf vectors per example
  const docVectors = docs.map(d => {
    const tf = Object.create(null);
    let maxf = 0;
    for (const t of d.tokens) {
      tf[t] = (tf[t] || 0) + 1;
      if (tf[t] > maxf) maxf = tf[t];
    }
    // normalized tf * idf
    const vec = Object.create(null);
    for (const [t, f] of Object.entries(tf)) vec[t] = (f / Math.max(1, maxf)) * (idf[t] || 0);
    return { intent: d.intent, vec };
  });

  // centroid per intent (average of example vectors)
  const centroids = Object.create(null);
  const counts = Object.create(null);
  for (const d of docVectors) {
    const key = d.intent;
    counts[key] = (counts[key] || 0) + 1;
    if (!centroids[key]) centroids[key] = Object.create(null);
    for (const [t, v] of Object.entries(d.vec)) centroids[key][t] = (centroids[key][t] || 0) + v;
  }
  for (const k of Object.keys(centroids)) {
    const c = centroids[k];
    const cnt = counts[k] || 1;
    for (const t of Object.keys(c)) c[t] = c[t] / cnt;
    // normalize
    const norm = Math.sqrt(Object.values(c).reduce((s, x) => s + x * x, 0)) || 1;
    for (const t of Object.keys(c)) c[t] = c[t] / norm;
  }

  return { idf, vocab: Object.keys(vocab), centroids };
}

function _vectorizeQuery(query, idf) {
  const tokens = tokenize(query);
  const tf = Object.create(null);
  let maxf = 0;
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
    if (tf[t] > maxf) maxf = tf[t];
  }
  const vec = Object.create(null);
  for (const [t, f] of Object.entries(tf)) {
    if (idf[t]) vec[t] = (f / Math.max(1, maxf)) * idf[t];
  }
  // normalize
  const norm = Math.sqrt(Object.values(vec).reduce((s, x) => s + x * x, 0)) || 1;
  for (const t of Object.keys(vec)) vec[t] = vec[t] / norm;
  return vec;
}

function _cosine(a, b) {
  let s = 0;
  // iterate over smaller object
  const ka = Object.keys(a), kb = Object.keys(b);
  const small = ka.length <= kb.length ? a : b;
  const large = ka.length <= kb.length ? b : a;
  for (const t of Object.keys(small)) {
    if (large[t]) s += small[t] * large[t];
  }
  return s;
}

function detectIntent(model, query, opts = {}) {
  const { idf, centroids } = model;
  const vec = _vectorizeQuery(query, idf);
  const scores = [];
  for (const [intent, cent] of Object.entries(centroids)) scores.push({ intent, score: _cosine(vec, cent) });
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] || { intent: null, score: 0 };
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.15;
  return { intent: best.score >= threshold ? best.intent : null, score: best.score, scores };
}

module.exports = { buildModel, detectIntent };
