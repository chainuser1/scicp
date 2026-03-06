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
  id,
});

const findHandler = (socket, event) => {
  const registered = socket.on.mock.calls.find(([name]) => name === event);
  if (!registered) throw new Error(`Missing socket handler for ${event}`);
  return registered[1];
};

// Ensure all mocks are reset before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('socket events', () => {
  test('go-live emits only to target session room', () => {
    const roomEmitter = { emit: jest.fn() };
    const mockIo = {
      on: jest.fn(),
      to: jest.fn(() => roomEmitter),
    };
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
    expect(roomEmitter.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
      book_title: '1 Nephi',
      segments: ['test text'],
      totalSegments: 1,
      currentSegment: 0
    }));
    
    expect(roomEmitter.emit).toHaveBeenCalledWith('update-theme', {});
  });

  test('update-verse uses active joined session when payload omits sessionId', () => {
    const roomEmitter = { emit: jest.fn() };
    const mockIo = {
      on: jest.fn(),
      to: jest.fn(() => roomEmitter),
    };
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
    expect(roomEmitter.emit).toHaveBeenCalledWith('update-verse', payload);
  });

  test('joining existing session receives latest verse snapshot', () => {
    const roomEmitter = { emit: jest.fn() };
    const mockIo = {
      on: jest.fn(),
      to: jest.fn(() => roomEmitter),
    };
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
    connectHandler(clientSocket);
    const joinSession = findHandler(clientSocket, 'join-session');
    joinSession({ sessionId: 'ROOM99' }, jest.fn());

    expect(clientSocket.emit).toHaveBeenCalledWith('session-joined', { sessionId: 'ROOM99' });
    expect(clientSocket.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
    }));
  });
});
