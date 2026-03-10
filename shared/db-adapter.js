'use strict';

// ── Database Adapter ────────────────────────────────────────────────────────
// Normalizes the API between better-sqlite3 (Node.js / Electron) and sql.js
// (WASM / mobile).  Every query function in scripture-engine.js calls
//   adapter.prepare(sql).all(...params)
//   adapter.prepare(sql).get(...params)
//   adapter.prepare(sql).run(...params)
//   adapter.exec(sql)
// regardless of the underlying engine.

// ── BetterSqliteAdapter ─────────────────────────────────────────────────────
// Wraps a better-sqlite3 Database instance.  Since better-sqlite3 already uses
// .prepare().all()/.get()/.run(), this is a thin pass-through.
class BetterSqliteAdapter {
  constructor(db) {
    this._db = db;
  }

  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return {
      all(...params) { return stmt.all(...params); },
      get(...params) { return stmt.get(...params); },
      run(...params) { return stmt.run(...params); },
    };
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  get raw() { return this._db; }
}

// ── SqlJsAdapter ────────────────────────────────────────────────────────────
// Wraps a sql.js Database instance.  sql.js uses a different API:
//   db.exec(sql, params) -> [{ columns, values }]
// This adapter normalizes it to the same .prepare().all()/.get()/.run() shape.
class SqlJsAdapter {
  constructor(db) {
    this._db = db;
  }

  prepare(sql) {
    const dbRef = this._db;

    return {
      all(...params) {
        try {
          const stmt = dbRef.prepare(sql);
          if (params.length) stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        } catch (err) {
          // Re-throw with the SQL for debugging
          err.message = `${err.message} (SQL: ${sql.slice(0, 100)})`;
          throw err;
        }
      },

      get(...params) {
        try {
          const stmt = dbRef.prepare(sql);
          if (params.length) stmt.bind(params);
          let result = null;
          if (stmt.step()) {
            result = stmt.getAsObject();
          }
          stmt.free();
          return result;
        } catch (err) {
          err.message = `${err.message} (SQL: ${sql.slice(0, 100)})`;
          throw err;
        }
      },

      run(...params) {
        try {
          dbRef.run(sql, params);
          return { changes: dbRef.getRowsModified() };
        } catch (err) {
          err.message = `${err.message} (SQL: ${sql.slice(0, 100)})`;
          throw err;
        }
      },
    };
  }

  exec(sql) {
    return this._db.run(sql);
  }

  get raw() { return this._db; }
}

module.exports = { BetterSqliteAdapter, SqlJsAdapter };
