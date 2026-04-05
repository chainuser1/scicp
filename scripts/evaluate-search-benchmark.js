#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BENCHMARK_PATH = path.join(__dirname, '..', 'resources', 'search-benchmark.json');
const DEFAULT_BASELINE_PATH = path.join(__dirname, '..', 'artifacts', 'search-baselines', 'latest-current-model.json');

function parseArgs(argv) {
  const parsed = { baselinePath: null, failFast: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline' && argv[i + 1]) parsed.baselinePath = argv[++i];
    if (argv[i] === '--no-fail-fast') parsed.failFast = false;
  }
  return parsed;
}

function percentage(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findExpectedRank(snapshot, acceptedTitles) {
  const rows = snapshot.topResults || [];
  const index = rows.findIndex((row) => acceptedTitles.includes(row.verse_title));
  return index >= 0 ? index + 1 : null;
}

// NDCG@k for a single-positive query: DCG / IDCG where IDCG = 1/log2(2) = 1.
// Queries without positive expectations are excluded from the NDCG average.
function dcgAtK(rank, k) {
  if (rank === null || rank > k) return 0;
  return 1 / Math.log2(rank + 1);
}

// Score-rank monotonicity: fraction of consecutive result pairs where
// specificity_score[i] >= specificity_score[i+1]. A perfectly calibrated
// ranking scores 1.0. Returns null when fewer than 2 scored results exist.
function computeScoreMonotonicity(topResults) {
  const scores = (topResults || [])
    .map((r) => r.specificity_score)
    .filter((s) => s !== null && s !== undefined);
  if (scores.length < 2) return null;
  let monotone = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i - 1] >= scores[i]) monotone++;
  }
  return monotone / (scores.length - 1);
}

function computeMetrics(judgedRows) {
  const total = judgedRows.length;
  const rowsWithPositive = judgedRows.filter((row) => row.expectedVerseTitles.length > 0);
  const rowsWithForbidden = judgedRows.filter((row) => row.forbiddenTop1VerseTitles.length > 0 || row.forbiddenTop5VerseTitles.length > 0);
  const top1Hits = rowsWithPositive.filter((row) => row.expectedRank === 1).length;
  const top3Hits = rowsWithPositive.filter((row) => row.expectedRank !== null && row.expectedRank <= 3).length;
  const top5Hits = rowsWithPositive.filter((row) => row.expectedRank !== null && row.expectedRank <= 5).length;
  const thresholdPasses = judgedRows.filter((row) => row.passedThreshold).length;
  const reciprocalRankSum = rowsWithPositive.reduce((sum, row) => sum + (row.expectedRank ? 1 / row.expectedRank : 0), 0);

  const ndcg5 = rowsWithPositive.length
    ? rowsWithPositive.reduce((s, row) => s + dcgAtK(row.expectedRank, 5), 0) / rowsWithPositive.length
    : null;
  const ndcg10 = rowsWithPositive.length
    ? rowsWithPositive.reduce((s, row) => s + dcgAtK(row.expectedRank, 10), 0) / rowsWithPositive.length
    : null;

  // Score monotonicity averaged over queries that have ≥ 2 scored results
  const monotoneValues = judgedRows
    .map((row) => row.scoreMonotonicity)
    .filter((v) => v !== null && v !== undefined);
  const avgMonotonicity = monotoneValues.length
    ? monotoneValues.reduce((s, v) => s + v, 0) / monotoneValues.length
    : null;

  const headProbabilityRows = rowsWithPositive.filter((row) => row.top1Probability !== null && row.top1Probability !== undefined);
  const headBrier = headProbabilityRows.length
    ? headProbabilityRows.reduce((sum, row) => sum + ((row.top1Probability - (row.expectedRank === 1 ? 1 : 0)) ** 2), 0) / headProbabilityRows.length
    : null;

  const falsePositiveViolations = rowsWithForbidden.filter((row) => row.forbiddenTop1Offender || row.forbiddenTop5Offender).length;
  const phraseRows = judgedRows.filter((row) => row.category === 'phrase-fragment');
  const exactRows = judgedRows.filter((row) => row.category === 'exact-reference');

  return {
    total,
    positiveTotal: rowsWithPositive.length,
    top1Accuracy: percentage(top1Hits, rowsWithPositive.length || total),
    top3Accuracy: percentage(top3Hits, rowsWithPositive.length || total),
    recallAt5: percentage(top5Hits, rowsWithPositive.length || total),
    thresholdPassRate: percentage(thresholdPasses, total),
    mrr: rowsWithPositive.length ? reciprocalRankSum / rowsWithPositive.length : 0,
    ndcg5,
    ndcg10,
    avgMonotonicity,
    positiveQueryCount: rowsWithPositive.length,
    exactReferenceTop1: exactRows.length ? percentage(exactRows.filter((row) => row.expectedRank === 1).length, exactRows.length) : null,
    phraseFragmentTop3: phraseRows.length ? percentage(phraseRows.filter((row) => row.expectedRank !== null && row.expectedRank <= 3).length, phraseRows.length) : null,
    falsePositiveRate: rowsWithForbidden.length ? percentage(falsePositiveViolations, rowsWithForbidden.length) : null,
    headBrier,
  };
}

function printSummary(label, metrics) {
  console.log(label);
  console.log(`  total: ${metrics.total}`);
  if (metrics.positiveTotal) {
    console.log(`  positive queries: ${metrics.positiveTotal}`);
  }
  console.log(`  top1 accuracy: ${formatPercent(metrics.top1Accuracy)}`);
  console.log(`  Recall@3: ${formatPercent(metrics.top3Accuracy)}`);
  console.log(`  Recall@5: ${formatPercent(metrics.recallAt5)}`);
  console.log(`  threshold pass rate: ${formatPercent(metrics.thresholdPassRate)}`);
  console.log(`  MRR: ${metrics.mrr.toFixed(3)}`);
  if (metrics.ndcg5 !== null && metrics.ndcg5 !== undefined) {
    console.log(`  NDCG@5: ${metrics.ndcg5.toFixed(3)}  NDCG@10: ${metrics.ndcg10.toFixed(3)}  (n=${metrics.positiveQueryCount} positive queries)`);
  }
  if (metrics.exactReferenceTop1 !== null && metrics.exactReferenceTop1 !== undefined) {
    console.log(`  exact-reference top1: ${formatPercent(metrics.exactReferenceTop1)}`);
  }
  if (metrics.phraseFragmentTop3 !== null && metrics.phraseFragmentTop3 !== undefined) {
    console.log(`  phrase-fragment top3: ${formatPercent(metrics.phraseFragmentTop3)}`);
  }
  if (metrics.falsePositiveRate !== null && metrics.falsePositiveRate !== undefined) {
    console.log(`  false-positive rate: ${formatPercent(metrics.falsePositiveRate)}`);
  }
  if (metrics.avgMonotonicity !== null && metrics.avgMonotonicity !== undefined) {
    console.log(`  score monotonicity: ${formatPercent(metrics.avgMonotonicity * 100)}  (calibration proxy)`);
  }
  if (metrics.headBrier !== null && metrics.headBrier !== undefined) {
    console.log(`  head Brier: ${metrics.headBrier.toFixed(3)}  (top-result calibration)`);
  }
}

function normalizeTitles(list) {
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function evaluateForbiddenConstraint(snapshot, forbiddenTitles, limit) {
  const topRows = (snapshot?.topResults || []).slice(0, limit);
  const offending = topRows.find((row) => forbiddenTitles.includes(row.verse_title));
  return {
    passed: !offending,
    offendingTitle: offending?.verse_title || null,
  };
}

function exitProcess(code) {
  // Exit explicitly so npm never sits on a seemingly-live process after the
  // benchmark result has already been printed.
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const benchmark = loadJson(BENCHMARK_PATH);
  const baselinePath = args.baselinePath || DEFAULT_BASELINE_PATH;

  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline file not found: ${baselinePath}`);
  }

  const baseline = loadJson(baselinePath);
  const baselineById = new Map((baseline.queries || []).map((entry) => [entry.id, entry]));

  const judgedRows = [];
  for (const queryDef of benchmark.queries) {
    const snapshot = baselineById.get(queryDef.id);
    const expectedVerseTitles = normalizeTitles(queryDef.expectedVerseTitles);
    const expectedRank = snapshot ? findExpectedRank(snapshot, expectedVerseTitles) : null;
    const targetRankThreshold = queryDef.targetRankThreshold ?? null;
    const positivePass = targetRankThreshold === null
      ? true
      : expectedRank !== null && expectedRank <= targetRankThreshold;
    const forbiddenTop1 = normalizeTitles(queryDef.forbiddenTop1VerseTitles);
    const forbiddenTop5 = normalizeTitles(queryDef.forbiddenTop5VerseTitles);
    const top1Check = evaluateForbiddenConstraint(snapshot, forbiddenTop1, 1);
    const top5Check = evaluateForbiddenConstraint(snapshot, forbiddenTop5, 5);
    const passedThreshold = positivePass && top1Check.passed && top5Check.passed;
    const scoreMonotonicity = snapshot ? computeScoreMonotonicity(snapshot.topResults) : null;
    const row = {
      id: queryDef.id,
      label: queryDef.label,
      category: queryDef.category || 'uncategorized',
      query: queryDef.query,
      expectedVerseTitles,
      targetRankThreshold,
      expectedRank,
      passedThreshold,
      forbiddenTop1VerseTitles: forbiddenTop1,
      forbiddenTop5VerseTitles: forbiddenTop5,
      forbiddenTop1Offender: top1Check.offendingTitle,
      forbiddenTop5Offender: top5Check.offendingTitle,
      top1: snapshot?.topResults?.[0]?.verse_title || null,
      top1Probability: snapshot?.topResults?.[0]?.relevance_probability ?? null,
      scoreMonotonicity,
    };
    judgedRows.push(row);

    if (args.failFast && !row.passedThreshold) {
      console.log(`Benchmark: ${path.relative(process.cwd(), baselinePath)}`);
      console.log('');
      if (row.forbiddenTop1Offender) {
        console.log(`First failure: ${row.id}: forbidden top1 result ${row.forbiddenTop1Offender}`);
      } else if (row.forbiddenTop5Offender) {
        console.log(`First failure: ${row.id}: forbidden top5 result ${row.forbiddenTop5Offender}`);
      } else {
        console.log(`First failure: ${row.id}: expected one of [${row.expectedVerseTitles.join(', ')}] within top ${row.targetRankThreshold}; got rank ${row.expectedRank ?? 'MISS'} (top1=${row.top1 ?? 'none'})`);
      }
      exitProcess(1);
    }
  }

  const overall = computeMetrics(judgedRows);
  printSummary(`Benchmark: ${path.relative(process.cwd(), baselinePath)}`, overall);

  const categoryMap = new Map();
  for (const row of judgedRows) {
    if (!categoryMap.has(row.category)) categoryMap.set(row.category, []);
    categoryMap.get(row.category).push(row);
  }

  console.log('\nBy category:');
  for (const [category, rows] of [...categoryMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    printSummary(`- ${category}`, computeMetrics(rows));
  }

  const failures = judgedRows.filter((row) => !row.passedThreshold);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const row of failures) {
      if (row.forbiddenTop1Offender) {
        console.log(`- ${row.id}: forbidden top1 result ${row.forbiddenTop1Offender}`);
        continue;
      }
      if (row.forbiddenTop5Offender) {
        console.log(`- ${row.id}: forbidden top5 result ${row.forbiddenTop5Offender}`);
        continue;
      }
      console.log(`- ${row.id}: expected one of [${row.expectedVerseTitles.join(', ')}] within top ${row.targetRankThreshold}; got rank ${row.expectedRank ?? 'MISS'} (top1=${row.top1 ?? 'none'})`);
    }
  } else {
    console.log('\nAll judged benchmark queries passed their target rank thresholds.');
  }

  exitProcess(failures.length > 0 ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  exitProcess(1);
}