#!/usr/bin/env python3
"""Offline XGBoost trainer for scicp search weights."""
import sqlite3
import sys
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
    import xgboost as xgb
    from sklearn.linear_model import Ridge
except ImportError as e:
    print('Missing dependency:', e)
    print('pip install xgboost pandas numpy scikit-learn')
    sys.exit(1)

DB_PATH = Path(__file__).resolve().parents[1] / 'resources' / 'db' / 'user-data.db'
if not DB_PATH.exists():
    DB_PATH = Path(__file__).resolve().parents[1] / 'backend' / 'user-data.db'
if not DB_PATH.exists():
    print('Cannot find user-data.db')
    sys.exit(1)

conn = sqlite3.connect(str(DB_PATH))

fb = pd.read_sql_query(
    'SELECT id, query, verse_id, rank_shown, source, ts FROM search_feedback ORDER BY ts DESC LIMIT 10000',
    conn,
)
if fb.empty:
    print('No data found in search_feedback. Nothing to train.')
    sys.exit(0)

fb['label'] = 1.0 / (1.0 + fb['rank_shown'].fillna(10).astype(float))
fb['rank_norm'] = 1.0 / (1.0 + fb['rank_shown'].fillna(10).astype(float))
fb['rank_1'] = (fb['rank_shown'] == 0).astype(float)
source_map = {'fts': 0, 'fts-phrase': 1, 'semantic': 2, 'pagerank': 3, 'cross-ref': 4, 'cluster': 5, 'dwell': 6, 'topical-guide': 7}
fb['source_id'] = fb['source'].fillna('fts').map(source_map).fillna(0)

features = ['rank_norm', 'rank_1', 'source_id']
X = fb[features].astype(float)
y = fb['label'].astype(float)

# fallback to regression
try:
    dtrain = xgb.DMatrix(X, label=y)
    params = {'objective': 'reg:squarederror', 'eval_metric': 'rmse', 'eta': 0.1, 'max_depth': 4, 'verbosity': 0}
    bst = xgb.train(params, dtrain, num_boost_round=100)
    pred = bst.predict(dtrain)
except Exception as err:
    print('XGBoost train failed:', err)
    sys.exit(1)

model = Ridge(alpha=1.0)
model.fit(X, pred)
coeffs = model.coef_

# map into backend weights [bm25, semantic, pagerank, cross_ref, cluster, session, dwell]
weights = [1.0, 0.8, 0.3, 0.5, 0.3, 0.15]
weights[0] = max(0.05, min(3.0, abs(coeffs[0]) if len(coeffs) > 0 else 0.8))
weights[1] = max(0.05, min(3.0, abs(coeffs[1]) if len(coeffs) > 1 else 0.8))
weights[2] = max(0.05, min(3.0, abs(coeffs[2]) if len(coeffs) > 2 else 0.3))
print('Persisting weights', weights)

c = conn.cursor()
with conn:
    c.execute('CREATE TABLE IF NOT EXISTS learned_weights (key TEXT PRIMARY KEY, value REAL NOT NULL, updated_at INTEGER NOT NULL DEFAULT (CAST(strftime("%s","now") AS INTEGER) * 1000))')
    for i, w in enumerate(weights):
        c.execute('INSERT OR REPLACE INTO learned_weights (key, value) VALUES (?, ?)', (f'w{i}', float(w)))

print('Done')
