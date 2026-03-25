'use strict';

const { BetterSqliteAdapter, SqlJsAdapter } = require('../db-adapter');

describe('BetterSqliteAdapter', () => {
  test('wraps a mock db', () => {
    const mockStmt = {
      all: jest.fn(() => [{ id: 1 }]),
      get: jest.fn(() => ({ id: 1 })),
      run: jest.fn(() => ({ changes: 1 })),
    };
    const mockDb = {
      prepare: jest.fn(() => mockStmt),
      exec: jest.fn(),
    };
    const adapter = new BetterSqliteAdapter(mockDb);

    const result = adapter.prepare('SELECT 1').all();
    expect(result).toEqual([{ id: 1 }]);
    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT 1');

    const row = adapter.prepare('SELECT 1').get();
    expect(row).toEqual({ id: 1 });

    adapter.exec('CREATE TABLE test');
    expect(mockDb.exec).toHaveBeenCalled();
  });

  test('exposes raw property', () => {
    const mockDb = { prepare: jest.fn(), exec: jest.fn() };
    const adapter = new BetterSqliteAdapter(mockDb);
    expect(adapter.raw).toBe(mockDb);
  });
});

describe('SqlJsAdapter', () => {
  test('wraps a mock sql.js db', () => {
    let stepCount = 0;
    const mockDb = {
      prepare: jest.fn(() => ({
        bind: jest.fn(),
        step: jest.fn(() => {
          stepCount++;
          return stepCount <= 1; // return one row
        }),
        getAsObject: jest.fn(() => ({ id: 1, name: 'test' })),
        free: jest.fn(),
      })),
      run: jest.fn(),
      getRowsModified: jest.fn(() => 1),
    };
    const adapter = new SqlJsAdapter(mockDb);

    const rows = adapter.prepare('SELECT * FROM test').all();
    expect(rows).toEqual([{ id: 1, name: 'test' }]);

    stepCount = 0;
    const row = adapter.prepare('SELECT * FROM test').get();
    expect(row).toEqual({ id: 1, name: 'test' });
  });

  test('all() frees stmt even on error', () => {
    const freespy = jest.fn();
    const mockDb = {
      prepare: jest.fn(() => ({
        bind: jest.fn(() => { throw new Error('bind error'); }),
        step: jest.fn(),
        getAsObject: jest.fn(),
        free: freespy,
      })),
      run: jest.fn(),
      getRowsModified: jest.fn(),
    };
    const adapter = new SqlJsAdapter(mockDb);
    expect(() => adapter.prepare('SELECT 1').all(1)).toThrow('bind error');
    expect(freespy).toHaveBeenCalled();
  });

  test('get() frees stmt even on error', () => {
    const freespy = jest.fn();
    const mockDb = {
      prepare: jest.fn(() => ({
        bind: jest.fn(() => { throw new Error('bind error'); }),
        step: jest.fn(),
        getAsObject: jest.fn(),
        free: freespy,
      })),
      run: jest.fn(),
      getRowsModified: jest.fn(),
    };
    const adapter = new SqlJsAdapter(mockDb);
    expect(() => adapter.prepare('SELECT 1').get(1)).toThrow('bind error');
    expect(freespy).toHaveBeenCalled();
  });
});
