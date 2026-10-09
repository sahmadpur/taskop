import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { MEDIA_LIMITS } from '@taskop/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface PresignedPut {
  url: string;
  /** Exactly what the client must send with the PUT. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  contentLength: number;
  contentType: string | null;
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
};

/**
 * The only code that talks to object storage (spec §9). HEAD and DELETE go to S3_ENDPOINT; presigned URLs are signed
 * against S3_PUBLIC_ENDPOINT, because the signature covers the host the phone or browser will use.
 * Signatures use the real time, never the injectable Clock: storage checks them against its own clock.
 */
@Injectable()
export class S3Service implements OnModuleDestroy {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const base: S3ClientConfig = {
      region: 'us-east-1',
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // Newer SDKs add CRC32 checksum parameters to every PutObject; S3-compatible stores and presigned PUTs need them off.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.internal = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT });
    this.bucket = config.S3_BUCKET;
  }

  /** Presigned PUT valid 15 min with Content-Type and Content-Length bound (spec §6.7). */
  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    const expiresIn = MEDIA_LIMITS.uploadUrlTtlSeconds;
    const url = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      // The presigner leaves content-type unsigned by default; signableHeaders brings both back in.
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { url, headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /** Presigned GET valid 5 min; callers check permissions first. */
  async presignGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = MEDIA_LIMITS.downloadUrlTtlSeconds;
    const url = await getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /** null when the object does not exist (yet). */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentLength: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /** Idempotent: deleting a missing object succeeds. */
  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.internal.destroy();
    this.publicClient.destroy();
  }
}
