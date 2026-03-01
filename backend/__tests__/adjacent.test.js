const { fastify } = require('../index');

describe('adjacent verse endpoint', () => {
  beforeAll(async () => {
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('returns next verse for a known reference', async () => {
    // pick a verse that likely exists with another immediately after it
    const params = new URLSearchParams({
      book_title: 'John',
      chapter_number: '3',
      verse_number: '16',
      direction: 'next',
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveProperty('verse_number');
    expect(data.verse_number).toBe(17);
  });

  test('404 when out of range', async () => {
    const params = new URLSearchParams({
      book_title: 'John',
      chapter_number: '3',
      verse_number: '700',
      direction: 'next',
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(404);
  });
});
