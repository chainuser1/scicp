#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BENCHMARK_PATH = path.join(__dirname, '..', 'resources', 'search-benchmark.json');
const DEFAULT_BASELINE_PATH = path.join(__dirname, '..', 'artifacts', 'search-baselines', 'latest-current-model.json');

function parseArgs(argv) {
  const parsed = { baselinePath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline' && argv[i + 1]) parsed.baselinePath = argv[++i];
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

function computeMetrics(judgedRows) {
  const total = judgedRows.length;
  const top1Hits = judgedRows.filter((row) => row.expectedRank === 1).length;
  const top3Hits = judgedRows.filter((row) => row.expectedRank !== null && row.expectedRank <= 3).length;
  const thresholdPasses = judgedRows.filter((row) => row.passedThreshold).length;
  const reciprocalRankSum = judgedRows.reduce((sum, row) => sum + (row.expectedRank ? 1 / row.expectedRank : 0), 0);

  return {
    total,
    top1Accuracy: percentage(top1Hits, total),
    top3Accuracy: percentage(top3Hits, total),
    thresholdPassRate: percentage(thresholdPasses, total),
    mrr: total ? reciprocalRankSum / total : 0,
  };
}

function printSummary(label, metrics) {
  console.log(label);
  console.log(`  total: ${metrics.total}`);
  console.log(`  top1 accuracy: ${formatPercent(metrics.top1Accuracy)}`);
  console.log(`  top3 accuracy: ${formatPercent(metrics.top3Accuracy)}`);
  console.log(`  threshold pass rate: ${formatPercent(metrics.thresholdPassRate)}`);
  console.log(`  MRR: ${metrics.mrr.toFixed(3)}`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const benchmark = loadJson(BENCHMARK_PATH);
  const baselinePath = args.baselinePath || DEFAULT_BASELINE_PATH;

  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Baseline file not found: ${baselinePath}`);
  }

  const baseline = loadJson(baselinePath);
  const baselineById = new Map((baseline.queries || []).map((entry) => [entry.id, entry]));

  const judgedRows = benchmark.queries.map((queryDef) => {
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
    return {
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
    };
  });

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
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}