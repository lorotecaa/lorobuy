import crypto from 'node:crypto';

const BUCKET = 'contact-messages';
const FILE_PATTERN = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

export function createContactStore(adminSupabase) {
  if (!adminSupabase) return null;
  const storage = adminSupabase.storage.from(BUCKET);
  let bucketReady;

  async function ensureBucket() {
    if (!bucketReady) bucketReady = (async () => {
      const existing = await adminSupabase.storage.getBucket(BUCKET);
      if (!existing.error) {
        if (existing.data.public) throw new Error('Contact message bucket must be private.');
        return;
      }
      if (Number(existing.error.status) !== 404) throw existing.error;
      const created = await adminSupabase.storage.createBucket(BUCKET, {
        public: false,
        allowedMimeTypes: ['application/json'],
        fileSizeLimit: 65536,
      });
      if (!created.error) return;
      if (Number(created.error.status) === 409) {
        const retried = await adminSupabase.storage.getBucket(BUCKET);
        if (!retried.error && !retried.data.public) return;
      }
      throw created.error;
    })().catch(error => { bucketReady = null; throw error; });
    return bucketReady;
  }

  return {
    async save(message) {
      await ensureBucket();
      const filename = `${Date.now()}-${crypto.randomUUID()}.json`;
      const body = Buffer.from(JSON.stringify({ ...message, createdAt: new Date().toISOString() }), 'utf8');
      const { error } = await storage.upload(`incoming/${filename}`, body, {
        contentType: 'application/json',
        cacheControl: '0',
        upsert: false,
        metadata: { name: message.name, email: message.email, reason: message.reason },
      });
      if (error) throw error;
      return filename;
    },
    async list() {
      await ensureBucket();
      const { data, error } = await storage.list('incoming', {
        limit: 100,
        sortBy: { column: 'name', order: 'desc' },
      });
      if (error) throw error;
      return (data ?? []).filter(item => FILE_PATTERN.test(item.name)).map(item => ({
        id: item.name,
        createdAt: item.created_at ?? item.updated_at ?? null,
        name: typeof item.metadata?.name === 'string' ? item.metadata.name : '',
        email: typeof item.metadata?.email === 'string' ? item.metadata.email : '',
        reason: typeof item.metadata?.reason === 'string' ? item.metadata.reason : '',
      }));
    },
    async read(filename) {
      if (!FILE_PATTERN.test(filename)) return null;
      await ensureBucket();
      const { data, error } = await storage.download(`incoming/${filename}`);
      if (error) {
        if (Number(error.status) === 404) return null;
        throw error;
      }
      const message = JSON.parse(await data.text());
      return {
        id: filename,
        name: String(message.name ?? ''),
        email: String(message.email ?? ''),
        reason: String(message.reason ?? ''),
        orderNumber: String(message.orderNumber ?? ''),
        message: String(message.message ?? ''),
        createdAt: String(message.createdAt ?? ''),
      };
    },
  };
}
