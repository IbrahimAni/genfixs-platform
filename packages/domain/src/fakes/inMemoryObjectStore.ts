import type { ObjectStore } from '../ports/objectStore.js';

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array | string): Promise<void> {
    this.objects.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }

  async getText(key: string): Promise<string | undefined> {
    const body = this.objects.get(key);
    return body === undefined ? undefined : new TextDecoder().decode(body);
  }

  get size(): number {
    return this.objects.size;
  }
}
