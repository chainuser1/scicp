const { fastify } = require('../index');
const { io } = require('socket.io-client');

// We will start the Fastify server on a random port for testing.

describe('socket events', () => {
  let clientA, clientB;
  let port;

  beforeAll(async () => {
    await fastify.ready();
    // fastify.server.address() may not yet have a port if not listening
    // but our server listens on 3000 by default; we'll assume that or listen now if not.
    if (!fastify.server.address()) {
      await fastify.listen({ port: 0 });
    }
    port = fastify.server.address().port;
  });

  afterAll(async () => {
    if (clientA) clientA.close();
    if (clientB) clientB.close();
    await fastify.close();
  });

  test('go-live from one client is broadcast to others', (done) => {
    const url = `http://localhost:${port}`;
    clientA = io(url, { transports: ['websocket'], forceNew: true });
    clientB = io(url, { transports: ['websocket'], forceNew: true });

    const payload = { verse: { scripture_text: 'foo', verse_title: '1 Ne 1:1', theme: {} }, theme: {} };

    clientB.on('update-verse', (data) => {
      // Verify the broadcast includes the original verse data plus segmentation info
      expect(data.scripture_text).toBe(payload.verse.scripture_text);
      expect(data.verse_title).toBe(payload.verse.verse_title);
      expect(data.segments).toBeDefined(); // Should have segments array
      expect(data.currentSegment).toBe(0); // Should start at first segment
      expect(data.totalSegments).toBeDefined();
      clientA.close();
      clientB.close();
      done();
    });

    clientA.on('connect', () => {
      clientB.on('connect', () => {
        clientA.emit('go-live', payload);
      });
    });
  });

  test('segment update from one client is broadcast to others', (done) => {
    const url = `http://localhost:${port}`;
    const vA = io(url, { transports: ['websocket'], forceNew: true });
    const vB = io(url, { transports: ['websocket'], forceNew: true });

    const verseUpdate = {
      scripture_text: 'bar',
      verse_title: '1 Ne 1:2',
      segments: ['bar'],
      currentSegment: 1,
      totalSegments: 2,
    };

    vB.on('update-verse', (data) => {
      expect(data.currentSegment).toBe(verseUpdate.currentSegment);
      expect(data.totalSegments).toBe(verseUpdate.totalSegments);
      expect(data.scripture_text).toBe(verseUpdate.scripture_text);
      vA.close();
      vB.close();
      done();
    });

    vA.on('connect', () => {
      vB.on('connect', () => {
        vA.emit('update-verse', verseUpdate);
      });
    });
  });
});
