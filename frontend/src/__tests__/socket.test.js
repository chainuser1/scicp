import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock socket.io-client before importing the module under test
vi.mock('socket.io-client', () => {
  const mockSocket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn().mockReturnThis(),
    connected: false,
    id: 'mock-socket-id',
    io: { opts: {} },
  };
  return { io: vi.fn(() => mockSocket), default: { io: vi.fn(() => mockSocket) } };
});

describe('socket module', () => {
  let socketModule;

  beforeEach(async () => {
    vi.resetModules();
    socketModule = await import('../socket');
  });

  test('exports a socket object with expected Socket.IO properties', () => {
    const { socket } = socketModule;
    expect(socket).toBeDefined();
    expect(typeof socket.on).toBe('function');
    expect(typeof socket.off).toBe('function');
    expect(typeof socket.emit).toBe('function');
    expect(socket).toHaveProperty('connected');
  });

  test('exports isRemoteMode as a boolean', () => {
    expect(typeof socketModule.isRemoteMode).toBe('boolean');
  });

  test('socket has queue management methods', () => {
    const { socket } = socketModule;
    expect(typeof socket.flushQueue).toBe('function');
    expect(typeof socket.clearQueue).toBe('function');
    expect(typeof socket.onQueueChange).toBe('function');
    expect(typeof socket.queueLength).toBe('number');
  });

  test('singleton pattern - re-importing returns the same module', async () => {
    const secondImport = await import('../socket');
    expect(secondImport.socket).toBe(socketModule.socket);
  });

  test('queueLength starts at zero', () => {
    expect(socketModule.socket.queueLength).toBe(0);
  });

  test('clearQueue resets the queue', () => {
    const { socket } = socketModule;
    socket.clearQueue();
    expect(socket.queueLength).toBe(0);
  });

  test('onQueueChange returns an unsubscribe function', () => {
    const { socket } = socketModule;
    const listener = vi.fn();
    const unsub = socket.onQueueChange(listener);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
