# Upgrade Search

Concrete plan for turning scicp search into a stronger, more mathematically disciplined scripture retrieval engine.

This document is intentionally opinionated. It describes:

- what the current engine already does well
- what is weak or inconsistent today
- what mathematical upgrades are worth adding next
- what ideas are low-value or risky for this corpus
- how to validate each upgrade before shipping it

The goal is not to imitate web search mechanically. The goal is to use the right mathematics for a small, stable, scripture-centered corpus.

## Executive Summary

scicp already has the core ingredients of a serious retrieval system:

- exact reference parsing and lexical retrieval
- semantic embeddings and ANN search
- graph-derived structure
- offline prebaked artifacts
- probabilistic relevance calibration

The next step is not adding more random features. The next step is making the current math more coherent and more query-aware.

The highest-value upgrades are:

1. query-personalized graph propagation
2. a judged benchmark with real ranking metrics
3. stronger final fusion between lexical, semantic, graph, and structural signals
4. hard-negative training to reduce semantically plausible false positives
5. a small, weak verse-centrality prior used only as a tie-breaker

## Current Reality

### Honest Take

The search engine is already advanced for this domain, but it still has three major weaknesses:

1. the final ranking still depends on a partly hand-tuned mixture of strong signals rather than a rigorously validated fusion layer
2. the graph math exists, but it is not yet fully used in a query-conditioned way
3. evaluation is still too anecdotal; there is not yet a hard benchmark strong enough to drive upgrades with discipline

This means the engine can produce excellent wins on many searches, while still being fragile on phrase-heavy, scaffold-heavy, or doctrinally ambiguous queries.

### What I Already Have

| Area | What I Have | Why It Matters | Current Limitation |
|---|---|---|---|
| Reference retrieval | exact reference parsing, abbreviation expansion, direct scripture lookup | gives precision and prevents semantic drift | still needs continued normalization for malformed citations and wording variants |
| Lexical retrieval | FTS5, phrase handling, NEAR fallback, lexical coverage, anchor windows, sequence-style signals | keeps ranking grounded in actual wording | phrase-heavy scripture fragments can still confuse scoring when generic scaffolding dominates |
| Semantic retrieval | fine-tuned verse embeddings, concept embeddings, ANN via HNSW | enables paraphrase and concept search | semantic trust still needs stronger query-aware gating |
| Graph structure | kNN graph, spectral features, cluster structure, cross-reference relationships, topic/entity structure | allows doctrinal neighborhood reasoning | graph influence is not yet fully personalized to the query |
| Offline prebaking | embeddings, concept index, SVD, kNN, spectral, clusters, labels, entity centroids, HNSW, packaged search graph | makes mathematically rich retrieval feasible at runtime | rebuild validation still needs more explicit artifact sanity checks |
| Probability | logistic relevance probability and adaptive cutoff | improves confidence estimation and tail suppression | still needs broader calibration on a judged query set |
| Fusion | lexical + semantic + graph + specificity + source-tier scoring | combines multiple retrieval channels | fusion is still only partly calibrated and partly heuristic |

### What Is Good Right Now

- Exact references are strongly grounded.
- Multi-stage retrieval already exists.
- The engine does not rely on embeddings alone.
- Prebaked math is a real advantage in this stable corpus.
- Recent probability work improved confidence behavior on hard scripture-style queries.

### What Is Weak Right Now

- Query-intent-dependent weighting is not yet strong enough.
- Graph propagation is present, but not yet the best version of itself.
- Some features behave like good ingredients without a fully principled final recipe.
- Benchmarking is not yet strong enough to reliably prevent regressions.
- There is still risk of over-rewarding generic scriptural language when lexical structure is high but semantic specificity is weak.

## Mathematical Upgrades Worth Pursuing

### 1. Query-Personalized Graph Propagation

This is the most important Google-inspired idea that genuinely fits this corpus.

Do not use a global PageRank-like importance score as the main ranking mechanism. Instead:

1. seed a verse set from exact hits, lexical hits, semantic hits, and concept hits
2. propagate relevance locally through trusted graph edges
3. keep the walk shallow and query-conditioned
4. use the propagated score as an additional signal, not the whole ranking

Potential edge types:

- semantic kNN edges
- cross-reference edges
- topical guide / triple-index topic co-membership
- chapter adjacency
- shared entity links

Why it helps:

- lets doctrinally close verses surface even when wording differs
- uses the corpus structure instead of generic popularity
- is a better fit than global PageRank for scripture retrieval

Key guardrail:

- propagation must be weak enough that exact references and strong lexical matches still dominate when appropriate

### 2. Judged Benchmark and Ranking Metrics

This is mandatory. Without it, upgrades remain guesswork.

Build a benchmark set that includes:

- exact references
- abbreviated references
- scripture phrase fragments
- paraphrased doctrinal queries
- situational queries
- ambiguous theological queries
- false-positive stress tests

Track at least:

- Recall@k
- MRR
- NDCG@k
- exact-reference top-1 accuracy
- phrase-fragment top-3 accuracy
- calibration quality on head results
- false-positive rate on hard negative queries

Why it helps:

- converts search work from anecdotal tuning into measurable engineering
- makes future embedding upgrades and ranking changes safer
- prevents regressions hidden by a few good smoke-test examples

### 3. Stronger Final Fusion

The current engine already exposes many useful signals. The next step is to combine them more rigorously.

Candidate feature families:

- lexical coverage
- phrase coverage
- anchor window score
- sequence compactness
- semantic similarity
- concept similarity
- graph-propagated relevance
- source/tier information
- specificity score
- weak structural prior
- relevance probability

Two acceptable approaches:

1. improved hand-tuned fusion with stricter validation
2. a small learned fusion layer trained on judged pairs or judged rankings

Preferred rule:

- keep the final ranker interpretable
- do not replace the entire engine with an opaque black box

### 4. Hard-Negative Training

The embedding model will improve more from good negatives than from blindly adding more positives.

Good hard negatives include:

- verses with very similar scriptural scaffolding but wrong doctrine
- verses from the same book or topic that are related but not the right answer
- semantically tempting near-misses found by the current engine

Why it helps:

- reduces semantically plausible false positives
- improves discrimination on scripture-style queries
- sharpens the embedding space for reranking and ANN retrieval

Guardrail:

- bad negatives can poison the embedding space, so curate this carefully

### 5. Weak Verse-Centrality Prior

Prebake a small prior for verse centrality using the scripture graph.

Possible sources:

- cross-reference degree
- topic-membership robustness
- entity graph participation
- semantic graph connectivity

Use it only as:

- a tie-breaker
- a weak prior in broad conceptual searches

Do not use it as:

- a dominant rank signal
- a replacement for lexical or semantic evidence

Why it can help:

- helps broad thematic searches when several candidates are otherwise similar

Why it can hurt if misused:

- famous verses start winning for the wrong reasons

### 6. Better Query Taxonomy

The engine should more explicitly distinguish between:

- exact reference queries
- phrase-fragment queries
- keyword queries
- conceptual/doctrinal queries
- situational queries
- explicit semantic mode

Why it helps:

- lexical, semantic, and graph signals should not have the same trust weight across all query families

Example:

- exact references should heavily suppress graph diffusion
- phrase fragments should trust sequence and compactness more than concept spread
- conceptual queries should trust semantic + graph expansion more than exact text overlap

## Mathematical Ideas I Do Not Yet Fully Have

| Capability | What It Would Add | Why It Helps | Why It Might Not Help or Must Be Limited |
|---|---|---|---|
| query-personalized graph propagation | local doctrinal neighborhood reasoning | best fit for scripture graph math | can drift into famous-verse gravity if too strong |
| learned fusion model | more disciplined score combination | can outperform ad hoc weighting | only worth it with a good judged benchmark |
| hard-negative training | sharper semantic discrimination | reduces false positives | requires careful curation |
| weak verse centrality prior | small notion of structural importance | useful as a tie-breaker | dangerous if made dominant |
| explicit uncertainty modeling | better handling of ambiguous or low-confidence queries | helps cutoff and confidence | weak value without strong calibration data |
| broader calibration evaluation | measurable probability quality | makes the probability layer trustworthy | requires labeled relevance judgments |
| diversification optimization | avoids redundant top results on broad conceptual queries | better result set quality | can hurt exact phrase queries if overused |
| learned user-feedback loop | adaptation from real usage | potentially strong long-term gains | current signal volume or quality may be too weak |

## Mathematical Ideas To Avoid or Strictly Limit

| Idea | Why It Sounds Attractive | Why It Is Low Value or Risky Here |
|---|---|---|
| global PageRank as a dominant score | famous Google math | scripture centrality is not the same thing as query relevance |
| end-to-end black-box neural ranking | modern and powerful on paper | too opaque, too data-hungry, too hard to debug |
| heavy personalization | seems intelligent | risks inconsistency and doctrinal weirdness |
| freshness-heavy ranking | common in general web search | low relevance in a mostly static corpus |
| adding more embedding models without evaluation discipline | easy to keep experimenting | creates churn without guaranteed ranking gains |

## Target Architecture

The search engine should converge toward this structure:

1. query understanding
2. multi-channel candidate generation
3. query-personalized graph expansion
4. interpretable reranking
5. probability calibration
6. adaptive cutoff and diversification

Conceptually:

$$
\text{FinalScore}(v, q) =
\alpha \cdot \text{Lexical}(v, q)
+ \beta \cdot \text{Semantic}(v, q)
+ \gamma \cdot \text{GraphPropagated}(v, q)
+ \delta \cdot \text{Specificity}(v, q)
+ \epsilon \cdot \text{StructurePrior}(v)
$$

Then calibrate:

$$
P(\text{relevant} \mid v, q) = \sigma(f_1, f_2, \ldots, f_n)
$$

Where $f_i$ are interpretable retrieval features, not hidden end-to-end embeddings alone.

## Phased Upgrade Plan

### Phase 1: Stabilize and Measure

Objective:

- stop relying on intuition alone
- establish trustworthy evaluation

Tasks:

1. expand the search baseline set beyond smoke tests
2. create a judged benchmark across major query families
3. add automated comparison reports for before/after rebuilds
4. record calibration quality and false-positive behavior
5. add artifact sanity checks after prebake

Exit criteria:

- every search change can be evaluated on a stable benchmark
- every model rebuild can be compared against a baseline snapshot

### Phase 2: Improve Query-Aware Fusion

Objective:

- make the current signals combine more intelligently

Tasks:

1. strengthen query taxonomy
2. retune lexical vs semantic vs graph trust by query family
3. add feature-level analysis for common failure modes
4. either improve hand-tuned fusion or train a small interpretable fusion model
5. recalibrate relevance probability on judged examples

Exit criteria:

- broad conceptual queries improve without harming exact references
- phrase-fragment queries stop over-rewarding generic scaffolding

### Phase 3: Add Query-Personalized Graph Propagation

Objective:

- make the graph work for the current query rather than as a generic background feature

Tasks:

1. define edge weighting by trust class
2. seed propagation from the top lexical and semantic candidates
3. cap propagation depth and total influence
4. expose propagated score as a separate feature
5. validate gains against hard doctrinal and paraphrase queries

Exit criteria:

- doctrinal-neighborhood recall improves
- exact-reference precision does not regress
- graph drift remains controlled

### Phase 4: Sharpen the Embedding Space

Objective:

- reduce semantically plausible but wrong matches

Tasks:

1. build a hard-negative mining set from near-miss search results
2. add controlled hard negatives to training data
3. retrain and rebuild embeddings
4. compare benchmark metrics and false-positive audits

Exit criteria:

- lower false-positive rate on hard phrase and doctrinal searches
- improved semantic precision without recall collapse

### Phase 5: Add Weak Structural Priors

Objective:

- use corpus structure as a small ranking prior without overpowering the query

Tasks:

1. prebake verse centrality or authority-like scores
2. add them as weak reranking features
3. verify they only help broad searches and tie-breaks

Exit criteria:

- broad topical queries improve
- no visible “famous verse bias” regression

## Operational Rules

Use these rules during all search work:

1. lexical truth must dominate exact references and tight phrase queries
2. graph influence must always be query-conditioned and limited
3. semantic expansion must never become a license for doctrinal drift
4. every new signal must justify itself on benchmark metrics
5. every model rebuild must be compared against a stored baseline
6. avoid hidden magical weights with no measured reason to exist

## Immediate Next Actions

These are the next practical moves after the current prebake and rebuild work:

1. finish the current semantic artifact rebuild cleanly
2. capture a fresh baseline snapshot of the rebuilt model
3. run boss-query and hard-query smoke tests again
4. build the first real judged benchmark file
5. design a minimal query-personalized graph propagation experiment

## Bottom Line

scicp is already close to a powerful intelligent scripture search engine.

What it has now is strong enough to be serious.

What it still lacks is not “more AI” in the vague sense. What it lacks is:

- stricter evaluation
- better query-aware math
- better use of the graph
- better calibration and fusion discipline

If those upgrades are done carefully, the system can become unusually strong for this domain: precise on references, resilient on phrase fragments, meaningful on doctrinal concepts, and less vulnerable to generic scriptural false positives.