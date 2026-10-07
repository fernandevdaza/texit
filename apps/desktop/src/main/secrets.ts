/**
 * Secrets encrypted with the OS keychain via Electron `safeStorage`
 * (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux) and kept in
 * a JSON file in userData. Plain values never touch the disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

type Store = Record<string, string>; // key → base64(encrypted)

export class SecretStore {
  private cache: Store | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private ensureAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system (no OS keychain / secret service).');
    }
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend?.();
      if (backend === 'basic_text') {
        throw new Error('No Linux secret service (gnome-keyring / kwallet) is available; refusing to store secrets in plain text.');
      }
    }
  }

  private load(): Store {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Store) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private persist(): Promise<void> {
    const data = JSON.stringify(this.load());
    this.writing = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, data, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    });
    return this.writing;
  }

  async get(key: string): Promise<string | null> {
    const enc = this.load()[key];
    if (!enc) return null;
    this.ensureAvailable();
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null; // keychain changed / corrupted entry
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.ensureAvailable();
    this.load()[key] = safeStorage.encryptString(value).toString('base64');
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    const store = this.load();
    if (!(key in store)) return;
    delete store[key];
    await this.persist();
  }
}
