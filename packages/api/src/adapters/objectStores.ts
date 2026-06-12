import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from '@genfixs/domain';

/** Real local artifact persistence: survives restarts, no external service. */
export class FsObjectStore implements ObjectStore {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const path = normalize(join(this.rootDir, key));
    if (!path.startsWith(normalize(this.rootDir))) {
      throw new Error(`Object key escapes the store root: ${key}`);
    }
    return path;
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return undefined;
    }
  }

  async getText(key: string): Promise<string | undefined> {
    const body = await this.get(key);
    return body === undefined ? undefined : new TextDecoder().decode(body);
  }
}

export interface S3ObjectStoreOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

/**
 * S3-compatible artifact store (spec §10.2) — AWS S3, MinIO, R2, etc.
 * Credentials via the standard AWS chain (see CREDENTIALS.md). Lifecycle
 * expiry is configured on the bucket, per spec §11.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStoreOptions) {
    this.client = new S3Client({
      ...(options.region ? { region: options.region } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
    });
  }

  async put(key: string, body: Uint8Array | string, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: typeof body === 'string' ? Buffer.from(body) : body,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return result.Body ? await result.Body.transformToByteArray() : undefined;
    } catch {
      return undefined;
    }
  }

  async getText(key: string): Promise<string | undefined> {
    const body = await this.get(key);
    return body === undefined ? undefined : new TextDecoder().decode(body);
  }
}
