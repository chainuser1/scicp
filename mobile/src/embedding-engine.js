/**
 * embedding-engine.js — Fine-tuned Scripture-MiniLM inference for mobile.
 *
 * Lazy-loads the scripture-minilm ONNX model via @xenova/transformers.
 * In Capacitor (native), fetches the model from the backend server.
 * In browser, loads from the same origin. Model is cached after first download.
 */

const SCRIPTURE_MODEL = 'scripture-minilm';
const FALLBACK_MODEL  = 'Xenova/all-MiniLM-L6-v2';

let pipeline = null;
let pipe = null;
let loading = false;
let loadError = null;

/**
 * Check if the user has opted in to enhanced AI search.
 */
export function isEnhancedSearchEnabled() {
  try {
    return localStorage.getItem('scicp_enhanced_search') === 'true';
  } catch { return false; }
}

/**
 * Toggle enhanced AI search on/off.
 */
export function setEnhancedSearch(enabled) {
  try {
    localStorage.setItem('scicp_enhanced_search', enabled ? 'true' : 'false');
  } catch {}
}

/**
 * Get the current status of the embedding engine.
 * @returns {'idle'|'loading'|'ready'|'error'}
 */
export function getStatus() {
  if (loadError) return 'error';
  if (pipe) return 'ready';
  if (loading) return 'loading';
  return 'idle';
}

/**
 * Initialize the embedding pipeline (lazy — call on first search if enabled).
 * Downloads the ONNX model on first use (~22MB quantized, cached by browser).
 * @param {function} [onProgress] — optional progress callback ({ status, progress })
 * @returns {Promise<boolean>} true if ready
 */
export async function initPipeline(onProgress) {
  if (pipe) return true;
  if (loading) {
    // Wait for existing load
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (pipe) { clearInterval(check); resolve(true); }
        if (loadError) { clearInterval(check); resolve(false); }
      }, 200);
    });
  }
  loading = true;
  loadError = null;
  try {
    const { pipeline: createPipeline, env } = await import('@xenova/transformers');
    pipeline = createPipeline;

    // Point @xenova/transformers to our backend for the fine-tuned model
    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const serverUrl = (isNative
      ? (localStorage.getItem('scicp_server_url') || 'https://cap-teyyko.live')
      : (window.location?.origin || '')
    ).replace(/\/$/, '');
    env.remoteHost = serverUrl + '/';
    env.remotePathTemplate = 'models/{model}/';
    env.allowLocalModels = false;

    try {
      pipe = await createPipeline('feature-extraction', SCRIPTURE_MODEL, {
        quantized: true,
        progress_callback: onProgress || undefined,
      });
    } catch (modelErr) {
      // Fallback to generic HuggingFace model if fine-tuned model unavailable
      console.warn('[EmbeddingEngine] Fine-tuned model unavailable, falling back:', modelErr.message);
      env.remoteHost = 'https://huggingface.co/';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
      pipe = await createPipeline('feature-extraction', FALLBACK_MODEL, {
        progress_callback: onProgress || undefined,
      });
    }
    loading = false;
    return true;
  } catch (err) {
    loadError = err;
    loading = false;
    console.warn('[EmbeddingEngine] Failed to load model:', err.message);
    return false;
  }
}

/**
 * Embed a query string → Float32Array(384).
 * Returns null if the pipeline isn't ready.
 */
export async function embedQuery(text) {
  if (!pipe) return null;
  try {
    const out = await pipe(text, { pooling: 'mean', normalize: true });
    return new Float32Array(out.data);
  } catch (err) {
    console.warn('[EmbeddingEngine] Inference failed:', err.message);
    return null;
  }
}

/**
 * Full semantic search: embed query → cosine similarity against all verse embeddings.
 * Falls back to null if pipeline not ready.
 */
export async function semanticSearch(queryText, embDb, adapter, limit = 30) {
  const qvec = await embedQuery(queryText);
  if (!qvec || !embDb) return null;

  const allRows = embDb.exec('SELECT verse_id, embedding FROM verse_embeddings');
  if (!allRows.length) return null;

  const scored = [];
  for (const [vid, blob] of allRows[0].values) {
    const vec = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    let dot = 0;
    for (let i = 0; i < 384; i++) dot += qvec[i] * vec[i];
    if (dot > 0.35) scored.push({ verse_id: vid, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);

  const stmt = adapter.prepare(
    'SELECT verse_id, verse_title, scripture_text, book_title, chapter_number, verse_number, chapter_id FROM scriptures WHERE verse_id = ?'
  );
  return scored.slice(0, limit).map(({ verse_id, score }, i) => {
    const row = stmt.get(verse_id);
    return row ? { ...row, _source: 'semantic', _embRank: i, similarity_score: +score.toFixed(4) } : null;
  }).filter(Boolean);
}
