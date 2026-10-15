import type { PresignedPut, StoredObject } from '../src/storage/s3.service';

/** An in-memory stand-in for S3Service, so job tests need no SeaweedFS. `failPut` makes every put throw. */
export class MemoryStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  failPut = false;

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPut) throw new Error('storage unavailable');
    this.objects.set(key, { body, contentType });
  }

  async getObject(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    return { url: `http://files.taskop.test/${key}`, headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresAt: new Date(Date.now() + 900_000) };
  }

  async presignGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    return { url: `http://files.taskop.test/${key}`, expiresAt: new Date(Date.now() + 300_000) };
  }
}
