const { fastify } = require('../index');

describe('adjacent verse endpoint', () => {
  beforeAll(async () => {
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('returns next verse for a known verse_id', async () => {
    // Use a deterministic verse_id (e.g., Genesis 1:1 is verse_id 1)
    const params = new URLSearchParams({
      verse_id: '1',
      direction: 'next',
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveProperty('verse_id');
    expect(data.verse_id).toBe(2);
  });

  test('returns previous verse for a known verse_id', async () => {
    const params = new URLSearchParams({
      verse_id: '2',
      direction: 'prev',
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveProperty('verse_id');
    expect(data.verse_id).toBe(1);
  });

  test('404 when out of range', async () => {
    const params = new URLSearchParams({
      verse_id: '999999',
      direction: 'next',
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(404);
  });

  test('400 when missing required params', async () => {
    const params = new URLSearchParams({
      verse_id: '1',
      // direction omitted
    });
    const res = await fastify.inject({ method: 'GET', url: `/verse/adjacent?${params}` });
    expect(res.statusCode).toBe(400);
  });
});