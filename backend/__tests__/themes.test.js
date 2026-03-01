const { fastify } = require('../index');

// use the same database file; tests will automatically create table if not exist

describe('themes API', () => {
  beforeAll(async () => {
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('GET /themes returns array', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/themes' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(Array.isArray(data)).toBe(true);
  });

  test('POST /themes creates and returns theme', async () => {
    const unique = `test-theme-${Date.now()}`;
    const theme = { name: unique, data: { background_url: 'foo' } };
    const res = await fastify.inject({
      method: 'POST',
      url: '/themes',
      payload: theme,
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveProperty('id');
    expect(data.name).toBe(unique);
    expect(data.data).toEqual(theme.data);
  });

  test('PUT /themes/:id updates theme', async () => {
    // create a theme first
    const unique = `updatable-${Date.now()}`;
    const create = await fastify.inject({ method: 'POST', url: '/themes', payload: { name: unique, data: { foo: 'bar' } } });
    const created = JSON.parse(create.payload);
    const res = await fastify.inject({
      method: 'PUT',
      url: `/themes/${created.id}`,
      payload: { name: unique, data: { foo: 'baz' } },
    });
    expect(res.statusCode).toBe(200);
    const updated = JSON.parse(res.payload);
    expect(updated.data.foo).toBe('baz');
  });

  test('DELETE /themes/:id removes theme', async () => {
    const unique = `deletable-${Date.now()}`;
    const create = await fastify.inject({ method: 'POST', url: '/themes', payload: { name: unique, data: { } } });
    const created = JSON.parse(create.payload);
    const res = await fastify.inject({ method: 'DELETE', url: `/themes/${created.id}` });
    expect(res.statusCode).toBe(200);
    const check = await fastify.inject({ method: 'GET', url: '/themes' });
    const list = JSON.parse(check.payload);
    expect(list.find((t) => t.id === created.id)).toBeUndefined();
  });
});
