/**
 * Pure embedding-based phrase matching using Chamfer Distance and Earth Mover's Distance
 * No FTS5, pure math: token-level alignment with order preservation
 * 
 * Catches word order variations: "still small voice" → "small still voice"
 * Catches paraphrases: "gift of Holy Ghost" → "Holy Ghost gift"
 * Catches morphological variants: "house of the Lord" → "Lord's house"
 */

// Simple stopwords list for English scripture
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 
    'by', 'at', 'from', 'as', 'is', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'but',
    'so', 'if', 'then', 'else', 'when', 'where', 'which', 'while', 'upon'
]);

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
}

// Simple tokenizer matching FTS5 behavior
function tokenize(text) {
    if (!text) return [];
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s\-']/g, '')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// Async token embedding (calls embedder if word not in cache)
async function embedTokens(tokens, embeddingCache, embedder = null) {
    const embeddings = [];
    for (const token of tokens) {
        let vec = embeddingCache.get(token);
        if (!vec && embedder) {
            try {
                const out = await embedder.encode(token, { pooling: 'mean', normalize: true });
                vec = new Float32Array(out.data);
                embeddingCache.set(token, vec);
            } catch (err) {
                continue;
            }
        }
        if (vec) embeddings.push(vec);
    }
    return embeddings;
}

/**
 * Chamfer Distance between two sets of points in 768D space
 * Lower distance = more similar (set similarity, order-agnostic)
 */
function chamferDistance(queryVecs, verseVecs) {
    if (queryVecs.length === 0 || verseVecs.length === 0) return 1.0;
    
    let sumQtoV = 0;
    for (const qv of queryVecs) {
        let minDist = Infinity;
        for (const vv of verseVecs) {
            const sim = cosineSimilarity(qv, vv);
            const dist = 1 - Math.max(0, Math.min(1, sim));
            if (dist < minDist) minDist = dist;
        }
        sumQtoV += minDist;
    }
    
    let sumVtoQ = 0;
    for (const vv of verseVecs) {
        let minDist = Infinity;
        for (const qv of queryVecs) {
            const sim = cosineSimilarity(vv, qv);
            const dist = 1 - Math.max(0, Math.min(1, sim));
            if (dist < minDist) minDist = dist;
        }
        sumVtoQ += minDist;
    }
    
    return (sumQtoV / queryVecs.length + sumVtoQ / verseVecs.length) / 2;
}

/**
 * Earth Mover's Distance with order constraint (1D optimal transport)
 */
function orderedEarthMover(queryVecs, verseVecs, maxWindow = 50) {
    if (queryVecs.length === 0 || verseVecs.length === 0) return 1.0;
    
    const m = queryVecs.length;
    const n = Math.min(verseVecs.length, maxWindow);
    
    const dp = Array(m + 1);
    for (let i = 0; i <= m; i++) {
        dp[i] = Array(n + 1);
        dp[i][0] = Infinity;
    }
    for (let j = 0; j <= n; j++) dp[0][j] = Infinity;
    dp[0][0] = 0;
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const sim = cosineSimilarity(queryVecs[i - 1], verseVecs[j - 1]);
            const cost = 1 - Math.max(0, Math.min(1, sim));
            dp[i][j] = cost + Math.min(
                dp[i - 1][j - 1],
                dp[i][j - 1],
                dp[i - 1][j]
            );
        }
    }
    
    let best = Infinity;
    for (let j = 1; j <= n; j++) {
        best = Math.min(best, dp[m][j]);
    }
    
    return Math.min(1.0, best / m);
}

/**
 * Batch process candidates from RRF results (not full corpus)
 */
async function batchPhraseMatch(queryPhrase, candidateVerses, embeddingCache, embedder = null, options = {}) {
    const { threshold = 0.55, maxResults = 15 } = options;
    const results = [];
    
    const queryTokens = tokenize(queryPhrase);
    if (queryTokens.length < 2) return results;
    
    const queryVecs = await embedTokens(queryTokens, embeddingCache, embedder);
    if (queryVecs.length === 0) return results;
    
    for (const candidate of candidateVerses) {
        const { verse_id, scripture_text, existingScore } = candidate;
        
        const verseTokens = tokenize(scripture_text);
        if (verseTokens.length < 3) continue;
        
        const verseVecs = await embedTokens(verseTokens, embeddingCache, embedder);
        if (verseVecs.length === 0) continue;
        
        // Quick pre-filter: token overlap
        const queryTokenSet = new Set(queryTokens);
        const verseTokenSet = new Set(verseTokens);
        let overlap = 0;
        for (const t of queryTokenSet) if (verseTokenSet.has(t)) overlap++;
        const tokenOverlap = overlap / queryTokenSet.size;
        
        if (tokenOverlap < 0.25) continue;
        
        const chamfer = chamferDistance(queryVecs, verseVecs);
        const chamferSim = Math.exp(-chamfer * 3);
        
        if (chamferSim < threshold * 0.7) continue;
        
        const emd = orderedEarthMover(queryVecs, verseVecs);
        const orderSim = Math.exp(-emd * 2.5);
        
        let finalScore = chamferSim * 0.5 + orderSim * 0.3 + tokenOverlap * 0.2;
        finalScore = Math.min(1.0, finalScore);
        
        if (finalScore >= threshold) {
            results.push({
                verse_id,
                score: finalScore,
                existingScore,
                chamferSim,
                orderSim
            });
        }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
}

// Single verse match for testing
async function phraseMatchEmbedding(queryPhrase, verseText, embeddingCache, embedder = null, options = {}) {
    const { threshold = 0.55 } = options;
    
    const queryTokens = tokenize(queryPhrase);
    const verseTokens = tokenize(verseText);
    
    if (queryTokens.length < 2 || verseTokens.length < 3) return { score: 0, isMatch: false };
    
    const queryVecs = await embedTokens(queryTokens, embeddingCache, embedder);
    const verseVecs = await embedTokens(verseTokens, embeddingCache, embedder);
    
    if (queryVecs.length === 0 || verseVecs.length === 0) return { score: 0, isMatch: false };
    
    const chamfer = chamferDistance(queryVecs, verseVecs);
    const chamferSim = Math.exp(-chamfer * 3);
    const emd = orderedEarthMover(queryVecs, verseVecs);
    const orderSim = Math.exp(-emd * 2.5);
    
    let score = chamferSim * 0.5 + orderSim * 0.5;
    score = Math.min(1.0, score);
    
    return { score, isMatch: score >= threshold, chamferSim, orderSim };
}

module.exports = {
    phraseMatchEmbedding,
    batchPhraseMatch,
    tokenize,
    cosineSimilarity,
    chamferDistance,
    orderedEarthMover
};