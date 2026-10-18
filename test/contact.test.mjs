import assert from 'node:assert/strict';
import test from 'node:test';
import { createContactStore } from '../src/contact.mjs';

test('contact messages are saved in a private bucket and readable only through the admin store', async () => {
  let bucketExists = false;
  let bucketOptions;
  const files = new Map();
  const bucket = {
    upload: async (path, body, options) => {
      assert.equal(options.contentType, 'application/json');
      files.set(path, { body, metadata: options.metadata });
      return { data: { path }, error: null };
    },
    list: async () => ({
      data: [...files].map(([path, value]) => ({
        name: path.split('/').at(-1),
        created_at: '2026-10-18T12:00:00Z',
        metadata: value.metadata,
      })),
      error: null,
    }),
    download: async path => ({ data: new Blob([files.get(path).body]), error: null }),
  };
  const admin = { storage: {
    from: id => { assert.equal(id, 'contact-messages'); return bucket; },
    getBucket: async () => bucketExists
      ? { data: { public: false }, error: null }
      : { data: null, error: { status: 404 } },
    createBucket: async (_id, options) => {
      bucketExists = true;
      bucketOptions = options;
      return { data: { name: 'contact-messages' }, error: null };
    },
  } };
  const store = createContactStore(admin);
  const id = await store.save({ name: 'Cliente', email: 'cliente@example.com', reason: 'download', orderNumber: '#1024', message: 'Mi archivo no abre.' });
  assert.equal(bucketOptions.public, false);
  assert.match(id, /^\d{13}-[0-9a-f-]{36}\.json$/);
  assert.equal((await store.list())[0].email, 'cliente@example.com');
  const result = await store.read(id);
  assert.equal(result.message, 'Mi archivo no abre.');
  assert.equal(result.orderNumber, '#1024');
  assert.equal(await store.read('../other.json'), null);
});

test('contact store refuses a public bucket', async () => {
  const store = createContactStore({ storage: {
    from: () => ({}),
    getBucket: async () => ({ data: { public: true }, error: null }),
  } });
  await assert.rejects(store.list(), /private/);
});
