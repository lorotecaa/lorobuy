import assert from 'node:assert/strict';
import test from 'node:test';
import { createContactStore } from '../src/contact.mjs';

test('contact messages use a private, purchase-unmapped prefix and are readable through the admin store', async () => {
  const files = new Map();
  const bucket = {
    upload: async (path, body, options) => {
      assert.equal(options.contentType, 'application/octet-stream');
      assert.match(path, /^contact-messages\/incoming\//);
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
    from: id => { assert.equal(id, 'product-files'); return bucket; },
  } };
  const store = createContactStore(admin);
  const id = await store.save({ name: 'Cliente', email: 'cliente@example.com', reason: 'download', orderNumber: '#1024', message: 'Mi archivo no abre.' });
  assert.match(id, /^\d{13}-[0-9a-f-]{36}\.json$/);
  assert.equal((await store.list())[0].email, 'cliente@example.com');
  const result = await store.read(id);
  assert.equal(result.message, 'Mi archivo no abre.');
  assert.equal(result.orderNumber, '#1024');
  assert.equal(await store.read('../other.json'), null);
});

test('contact store stays unavailable without the backend secret client', () => {
  assert.equal(createContactStore(null), null);
});
