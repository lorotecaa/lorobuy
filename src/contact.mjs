import crypto from 'node:crypto';

const BUCKET = 'product-files';
const PREFIX = 'contact-messages/incoming';
const FILE_PATTERN = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

export function createContactStore(adminSupabase) {
  if (!adminSupabase) return null;
  const storage = adminSupabase.storage.from(BUCKET);

  return {
    async save(message) {
      const filename = `${Date.now()}-${crypto.randomUUID()}.json`;
      const body = Buffer.from(JSON.stringify({ ...message, createdAt: new Date().toISOString() }), 'utf8');
      const { error } = await storage.upload(`${PREFIX}/${filename}`, body, {
        contentType: 'application/octet-stream',
        cacheControl: '0',
        upsert: false,
        metadata: { name: message.name, email: message.email, reason: message.reason },
      });
      if (error) throw error;
      return filename;
    },
    async list() {
      const { data, error } = await storage.list(PREFIX, {
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
      const { data, error } = await storage.download(`${PREFIX}/${filename}`);
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
