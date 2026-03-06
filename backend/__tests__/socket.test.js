const { fastify, registerSocketHandlers } = require('../index');

// Mock dependencies for test isolation
const mockSegmentVerseText = jest.fn((text) => [text]);
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
      book_title: '1 Nephi'
    })
  })
};
const mockDbCebuano = { ...mockDb };
const mockDbTagalog = { ...mockDb };

const createMockSocket = (id = 'test-socket-id') => ({
  on: jest.fn(),
  emit: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  rooms: new Set([id]),
  id,
});

const findHandler = (socket, event) => {
  const registered = socket.on.mock.calls.find(([name]) => name === event);
  if (!registered) throw new Error(`Missing socket handler for ${event}`);
  return registered[1];
};

const createMockIo = () => {
  const roomEmitters = new Map();
  const roomMembership = new Map();
  const connectedSockets = new Map();

  const getRoomEmitter = (roomId) => {
    if (!roomEmitters.has(roomId)) roomEmitters.set(roomId, { emit: jest.fn() });
    return roomEmitters.get(roomId);
  };

  return {
    io: {
      on: jest.fn(),
      to: jest.fn((roomId) => getRoomEmitter(roomId)),
      sockets: {
        sockets: connectedSockets,
        adapter: {
          rooms: {
            get: (roomId) => {
              const size = roomMembership.get(roomId) || 0;
              return size > 0 ? { size } : undefined;
            },
          },
        },
      },
    },
    connectSocket: (socket) => {
      connectedSockets.set(socket.id, socket);
      socket.join.mockImplementation((roomId) => {
        socket.rooms.add(roomId);
        roomMembership.set(roomId, (roomMembership.get(roomId) || 0) + 1);
      });
      socket.leave.mockImplementation((roomId) => {
        if (!socket.rooms.has(roomId)) return;
        socket.rooms.delete(roomId);
        const next = (roomMembership.get(roomId) || 0) - 1;
        if (next <= 0) roomMembership.delete(roomId);
        else roomMembership.set(roomId, next);
      });
    },
    roomEmitter: (roomId) => getRoomEmitter(roomId),
    roomSize: (roomId) => roomMembership.get(roomId) || 0,
    disconnectSocket: (socket) => {
      connectedSockets.delete(socket.id);
      socket.rooms.forEach((roomId) => {
        if (roomId === socket.id) return;
        const next = (roomMembership.get(roomId) || 0) - 1;
        if (next <= 0) roomMembership.delete(roomId);
        else roomMembership.set(roomId, next);
      });
    },
  };
};

// Ensure all mocks are reset before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('socket events', () => {
  test('go-live emits only to target session room', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText, 
      db: mockDb, 
      db_cebuano: mockDbCebuano, 
      db_tagalog: mockDbTagalog 
    });

    const socket = createMockSocket('presenter-1');
    harness.connectSocket(socket);
    connectHandler(socket);

    const createSession = findHandler(socket, 'create-session');
    const createAck = jest.fn();
    createSession({}, createAck);
    const sessionId = createAck.mock.calls[0][0].sessionId;

    const goLive = findHandler(socket, 'go-live');
    const payload = { 
      verse: { 
        scripture_text: 'foo', 
        verse_title: '1 Ne 1:1', 
        book_title: '1 Nephi',
        verse_id: '1' 
      },
      theme: {},
      sessionId,
    };

    goLive(payload);

    expect(mockIo.to).toHaveBeenCalledWith(sessionId);
    expect(harness.roomEmitter(sessionId).emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
      book_title: '1 Nephi',
      segments: ['test text'],
      totalSegments: 1,
      currentSegment: 0
    }));
    
    expect(harness.roomEmitter(sessionId).emit).toHaveBeenCalledWith('update-theme', {});
  });

  test('update-verse uses active joined session when payload omits sessionId', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText, 
      db: mockDb, 
      db_cebuano: mockDbCebuano, 
      db_tagalog: mockDbTagalog 
    });

    const socket = createMockSocket('presenter-2');
    harness.connectSocket(socket);
    connectHandler(socket);

    const createSession = findHandler(socket, 'create-session');
    const createAck = jest.fn();
    createSession({}, createAck);
    const sessionId = createAck.mock.calls[0][0].sessionId;

    const updateVerse = findHandler(socket, 'update-verse');
    const payload = { 
      scripture_text: 'bar', 
      verse_title: '2 Ne 2:2', 
      theme: {}, 
      segments: [], 
      currentSegment: 0, 
      totalSegments: 0 
    };
    updateVerse(payload);

    expect(mockIo.to).toHaveBeenLastCalledWith(sessionId);
    expect(harness.roomEmitter(sessionId).emit).toHaveBeenCalledWith('update-verse', payload);
  });

  test('joining existing session receives latest verse snapshot', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText,
      db: mockDb,
      db_cebuano: mockDbCebuano,
      db_tagalog: mockDbTagalog
    });

    const presenterSocket = createMockSocket('presenter-3');
    harness.connectSocket(presenterSocket);
    connectHandler(presenterSocket);
    const presenterCreate = findHandler(presenterSocket, 'create-session');
    const presenterCreateAck = jest.fn();
    presenterCreate({}, presenterCreateAck);
    const sessionId = presenterCreateAck.mock.calls[0][0].sessionId;
    const goLive = findHandler(presenterSocket, 'go-live');
    goLive({
      verse: {
        scripture_text: 'foo',
        verse_title: '1 Ne 1:1',
        book_title: '1 Nephi',
        verse_id: '1',
      },
      theme: {},
    });

    const clientSocket = createMockSocket('client-1');
    harness.connectSocket(clientSocket);
    connectHandler(clientSocket);
    const joinSession = findHandler(clientSocket, 'join-session');
    joinSession({ sessionId }, jest.fn());

    expect(clientSocket.emit).toHaveBeenCalledWith('session-joined', { sessionId });
    expect(clientSocket.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
    }));
  });

  test('session persists while one socket remains and is removed when last leaves', () => {
    jest.useFakeTimers();
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText,
      db: mockDb,
      db_cebuano: mockDbCebuano,
      db_tagalog: mockDbTagalog
    });

    const presenterSocket = createMockSocket('presenter-4');
    harness.connectSocket(presenterSocket);
    connectHandler(presenterSocket);
    const createSession = findHandler(presenterSocket, 'create-session');
    const createAck = jest.fn();
    createSession({}, createAck);
    const sessionId = createAck.mock.calls[0][0].sessionId;
    findHandler(presenterSocket, 'go-live')({
      verse: { scripture_text: 'foo', verse_title: '1 Ne 1:1', book_title: '1 Nephi', verse_id: '1' },
      theme: {},
    });

    const clientSocket = createMockSocket('client-2');
    harness.connectSocket(clientSocket);
    connectHandler(clientSocket);
    findHandler(clientSocket, 'join-session')({ sessionId }, jest.fn());

    // Presenter disconnects first; session should still be replayable for remaining client
    findHandler(presenterSocket, 'disconnecting')();
    harness.disconnectSocket(presenterSocket);
    findHandler(presenterSocket, 'disconnect')();

    const lateSocket = createMockSocket('client-3');
    harness.connectSocket(lateSocket);
    connectHandler(lateSocket);
    findHandler(lateSocket, 'join-session')({ sessionId }, jest.fn());
    expect(lateSocket.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
    }));

    // Last active socket disconnects; session should be terminated
    findHandler(clientSocket, 'disconnecting')();
    harness.disconnectSocket(clientSocket);
    findHandler(clientSocket, 'disconnect')();
    findHandler(lateSocket, 'disconnecting')();
    harness.disconnectSocket(lateSocket);
    findHandler(lateSocket, 'disconnect')();
    jest.runOnlyPendingTimers();

    const afterCleanup = createMockSocket('client-4');
    harness.connectSocket(afterCleanup);
    connectHandler(afterCleanup);
    findHandler(afterCleanup, 'join-session')({ sessionId }, jest.fn());
    expect(afterCleanup.emit).not.toHaveBeenCalledWith('update-verse', expect.anything());
    jest.useRealTimers();
  });

  test('join-session rejects unknown session ids', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText,
      db: mockDb,
      db_cebuano: mockDbCebuano,
      db_tagalog: mockDbTagalog
    });

    const socket = createMockSocket('presenter-5');
    harness.connectSocket(socket);
    connectHandler(socket);

    const joinAck = jest.fn();
    findHandler(socket, 'join-session')({ sessionId: 'ZZ999Z' }, joinAck);
    expect(joinAck).toHaveBeenCalledWith({ ok: false, message: 'Session not found' });
    expect(socket.emit).toHaveBeenCalledWith('session-error', { message: 'Session not found' });
  });

  test('only one presenter can control a session until current presenter leaves', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText,
      db: mockDb,
      db_cebuano: mockDbCebuano,
      db_tagalog: mockDbTagalog
    });

    const presenterA = createMockSocket('presenter-a');
    harness.connectSocket(presenterA);
    connectHandler(presenterA);

    const createSessionA = findHandler(presenterA, 'create-session');
    const createAckA = jest.fn();
    createSessionA({}, createAckA);
    const sessionId = createAckA.mock.calls[0][0].sessionId;

    const presenterB = createMockSocket('presenter-b');
    harness.connectSocket(presenterB);
    connectHandler(presenterB);

    const joinAsPresenterB = findHandler(presenterB, 'join-session');
    const joinAckBFirst = jest.fn();
    joinAsPresenterB({ sessionId, role: 'presenter' }, joinAckBFirst);
    expect(joinAckBFirst).toHaveBeenCalledWith({
      ok: false,
      message: 'Another presenter is active in this session'
    });
    expect(presenterB.emit).toHaveBeenCalledWith('session-error', {
      message: 'Another presenter is active in this session'
    });

    const leaveA = findHandler(presenterA, 'leave-session');
    const leaveAckA = jest.fn();
    leaveA({}, leaveAckA);
    expect(leaveAckA).toHaveBeenCalledWith({ ok: true, sessionId });

    const joinAckBSecond = jest.fn();
    joinAsPresenterB({ sessionId, role: 'presenter' }, joinAckBSecond);
    expect(joinAckBSecond).toHaveBeenCalledWith({ ok: true, sessionId });
  });

  test('stale presenter lock is released when prior presenter disconnects', () => {
    const harness = createMockIo();
    const mockIo = harness.io;
    let connectHandler;
    mockIo.on.mockImplementation((event, callback) => {
      if (event === 'connection') connectHandler = callback;
    });

    registerSocketHandlers(mockIo, {
      segmentVerseText: mockSegmentVerseText,
      db: mockDb,
      db_cebuano: mockDbCebuano,
      db_tagalog: mockDbTagalog
    });

    const presenterA = createMockSocket('presenter-old');
    harness.connectSocket(presenterA);
    connectHandler(presenterA);
    const createA = findHandler(presenterA, 'create-session');
    const createAckA = jest.fn();
    createA({}, createAckA);
    const sessionId = createAckA.mock.calls[0][0].sessionId;

    // Simulate abrupt disconnect path where only disconnect handler runs.
    harness.disconnectSocket(presenterA);
    findHandler(presenterA, 'disconnect')();

    const presenterB = createMockSocket('presenter-new');
    harness.connectSocket(presenterB);
    connectHandler(presenterB);
    const joinB = findHandler(presenterB, 'join-session');
    const joinAckB = jest.fn();
    joinB({ sessionId, role: 'presenter' }, joinAckB);

    expect(joinAckB).toHaveBeenCalledWith({ ok: true, sessionId });
  });
});
