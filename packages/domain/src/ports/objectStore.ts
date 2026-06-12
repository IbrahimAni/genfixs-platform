/** S3-compatible artifact storage (spec §10.2). Raw artifacts are lifecycle-expired. */
export interface ObjectStore {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  getText(key: string): Promise<string | undefined>;
}
