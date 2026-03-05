const { fastify, registerSocketHandlers } = require('../index');
const { Server } = require('socket.io');

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

// Create a mock io server instance for testing
const mockIo = {
  on: jest.fn(),
  emit: jest.fn()
};

// Mock socket instance
const mockSocket = {
  on: jest.fn(),
  emit: jest.fn(),
  id: 'test-socket-id'
};

// Mock the connection event to return our mock socket
mockIo.on.mockImplementation((event, callback) => {
  if (event === 'connection') {
    callback(mockSocket);
  }
});

// Ensure all mocks are reset before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('socket events', () => {
  test('go-live handler emits update-verse with segmented payload', () => {
    // Register handlers with mocked dependencies
    registerSocketHandlers(mockIo, { 
      segmentVerseText: mockSegmentVerseText, 
      db: mockDb, 
      db_cebuano: mockDbCebuano, 
      db_tagalog: mockDbTagalog 
    });

    // Simulate go-live event
    const payload = { 
      verse: { 
        scripture_text: 'foo', 
        verse_title: '1 Ne 1:1', 
        book_title: '1 Nephi',
        verse_id: '1' 
      }, 
      theme: {} 
    };
    
    // Call the registered 'go-live' handler logic
    mockSocket.on.mock.calls.forEach(([event, handler]) => {
      if (event === 'go-live') {
        handler(payload);
      }
    });

    // Verify update-verse was emitted with expected structure
    expect(mockIo.emit).toHaveBeenCalledWith('update-verse', expect.objectContaining({
      scripture_text: 'test text',
      verse_title: '1 Ne 1:1',
      book_title: '1 Nephi',
      segments: ['test text'],
      totalSegments: 1,
      currentSegment: 0
    }));
    
    // Verify update-theme was also emitted
    expect(mockIo.emit).toHaveBeenCalledWith('update-theme', {});
  });

  test('update-verse handler broadcasts to all clients', () => {
    // Register handlers with mocked dependencies
    registerSocketHandlers(mockIo, { 
      segmentVerseText: mockSegmentVerseText, 
      db: mockDb, 
      db_cebuano: mockDbCebuano, 
      db_tagalog: mockDbTagalog 
    });

    // Simulate update-verse event
    const payload = { 
      scripture_text: 'bar', 
      verse_title: '2 Ne 2:2', 
      theme: {}, 
      segments: [], 
      currentSegment: 0, 
      totalSegments: 0 
    };
    
    // Call the registered 'update-verse' handler logic
    mockSocket.on.mock.calls.forEach(([event, handler]) => {
      if (event === 'update-verse') {
        handler(payload);
      }
    });

    // Verify broadcast occurred
    expect(mockIo.emit).toHaveBeenCalledWith('update-verse', payload);
  });
});