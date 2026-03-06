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

  const getRoomEmitter = (roomId) => {
    if (!roomEmitters.has(roomId)) roomEmitters.set(roomId, { emit: jest.fn() });
    return roomEmitters.get(roomId);
  };

  return {
    io: {
      on: jest.fn(),
      to: jest.fn((roomId) => getRoomEmitter(roomId)),
      sockets: {
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

    const goLive = findHandler(socket, 'go-live');
    const payload = { 
      verse: { 
        scripture_text: 'foo', 
        verse_title: '1 Ne 1:1', 
        book_title: '1 Nephi',
        verse_id: '1' 
      },
      theme: {},
      sessionId: 'AB12CD',
    };

    goLive(payload);

    expect(mockIo.to).toHaveBeenCalledWith('AB12CD');
    expect(harness.roomEmitter('AB12CD').emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
      book_title: '1 Nephi',
      segments: ['test text'],
      totalSegments: 1,
      currentSegment: 0
    }));
    
    expect(harness.roomEmitter('AB12CD').emit).toHaveBeenCalledWith('update-theme', {});
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

    const joinSession = findHandler(socket, 'join-session');
    const joinAck = jest.fn();
    joinSession({ sessionId: 'ZX90QP' }, joinAck);
    expect(joinAck).toHaveBeenCalledWith({ ok: true, sessionId: 'ZX90QP' });

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

    expect(mockIo.to).toHaveBeenLastCalledWith('ZX90QP');
    expect(harness.roomEmitter('ZX90QP').emit).toHaveBeenCalledWith('update-verse', payload);
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
    const goLive = findHandler(presenterSocket, 'go-live');
    goLive({
      sessionId: 'ROOM99',
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
    joinSession({ sessionId: 'ROOM99' }, jest.fn());

    expect(clientSocket.emit).toHaveBeenCalledWith('session-joined', { sessionId: 'ROOM99' });
    expect(clientSocket.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
    }));
  });

  test('session persists while one socket remains and is removed when last leaves', () => {
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
    findHandler(presenterSocket, 'join-session')({ sessionId: 'KEEP01' }, jest.fn());
    findHandler(presenterSocket, 'go-live')({
      sessionId: 'KEEP01',
      verse: { scripture_text: 'foo', verse_title: '1 Ne 1:1', book_title: '1 Nephi', verse_id: '1' },
      theme: {},
    });

    const clientSocket = createMockSocket('client-2');
    harness.connectSocket(clientSocket);
    connectHandler(clientSocket);
    findHandler(clientSocket, 'join-session')({ sessionId: 'KEEP01' }, jest.fn());

    // Presenter disconnects first; session should still be replayable for remaining client
    findHandler(presenterSocket, 'disconnecting')();
    harness.disconnectSocket(presenterSocket);
    findHandler(presenterSocket, 'disconnect')();

    const lateSocket = createMockSocket('client-3');
    harness.connectSocket(lateSocket);
    connectHandler(lateSocket);
    findHandler(lateSocket, 'join-session')({ sessionId: 'KEEP01' }, jest.fn());
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

    const afterCleanup = createMockSocket('client-4');
    harness.connectSocket(afterCleanup);
    connectHandler(afterCleanup);
    findHandler(afterCleanup, 'join-session')({ sessionId: 'KEEP01' }, jest.fn());
    expect(afterCleanup.emit).not.toHaveBeenCalledWith('update-verse', expect.anything());
  });
});
