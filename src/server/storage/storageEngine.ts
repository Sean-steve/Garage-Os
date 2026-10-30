/**
 * Canonical Object & Media Storage Architecture (GAR-038 §1-§8, GAR-039 §11)
 *
 * Rules:
 * 1. Direct uploads use MIME validation and size limits.
 * 2. Original evidence is immutable; raw bucket paths are never exposed as authorization.
 * 3. Scoped temporary signed access tokens with time bounds.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../database/connection';
import { generateCanonicalUuid } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { DataClassificationLevel } from '../../shared/classification';
import { logger } from '../observability/logger';

export interface UploadFileInput {
  filename: string;
  buffer: Buffer;
  contentType: string;
  ownerId?: string;
  classification?: DataClassificationLevel;
}

export interface StoredFileRecord {
  id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  scan_status: 'UPLOADING' | 'QUARANTINED' | 'AVAILABLE' | 'REJECTED';
  owner_id?: string;
  data_classification: DataClassificationLevel;
  created_at: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
]);

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

export interface StorageDriver {
  put(key: string, buffer: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
}

class MemoryStorageDriver implements StorageDriver {
  private files = new Map<string, Buffer>();

  async put(key: string, buffer: Buffer): Promise<void> {
    this.files.set(key, buffer);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.files.get(key) || null;
  }

  async delete(key: string): Promise<boolean> {
    return this.files.delete(key);
  }
}

class StorageEngine {
  private driver: StorageDriver;
  private tokenSecret = crypto.randomBytes(32).toString('hex');

  constructor(driver?: StorageDriver) {
    this.driver = driver || new MemoryStorageDriver();
  }

  setDriver(driver: StorageDriver): void {
    this.driver = driver;
  }

  async storeFile(input: UploadFileInput): Promise<StoredFileRecord> {
    // 1. Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(input.contentType.toLowerCase())) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Prohibited file content type: ${input.contentType}. Only standard media and documents are permitted.`,
        400
      );
    }

    // 2. Validate Size
    if (input.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `File exceeds maximum permitted size of 15MB (got ${input.buffer.length} bytes)`,
        400
      );
    }

    const id = generateCanonicalUuid();
    const hash = crypto.createHash('sha256').update(input.buffer).digest('hex').substring(0, 16);
    const safeExt = input.filename.includes('.') ? input.filename.split('.').pop() : 'bin';
    const storageKey = `objects/${id}_${hash}.${safeExt}`;
    const now = getCurrentUtcIsoString();

    // Store bytes
    await this.driver.put(storageKey, input.buffer);

    // Save record to DB
    const db = getDatabase();
    db.prepare(`
      INSERT INTO file_objects (
        id, storage_key, filename, content_type, size_bytes,
        scan_status, owner_id, data_classification, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?, ?, ?, ?);
    `).run(
      id,
      storageKey,
      input.filename,
      input.contentType,
      input.buffer.length,
      input.ownerId || null,
      input.classification || DataClassificationLevel.INTERNAL,
      now,
      now
    );

    logger.info(`Stored object ${id} (${input.filename}) classification=${input.classification || 'INTERNAL'}`);

    return {
      id,
      storage_key: storageKey,
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.buffer.length,
      scan_status: 'AVAILABLE',
      owner_id: input.ownerId,
      data_classification: input.classification || DataClassificationLevel.INTERNAL,
      created_at: now,
    };
  }

  async getFile(fileId: string): Promise<{ record: StoredFileRecord; buffer: Buffer } | null> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM file_objects WHERE id = ?;').get(fileId) as unknown as StoredFileRecord | undefined;
    if (!row) return null;

    const buffer = await this.driver.get(row.storage_key);
    if (!buffer) return null;

    return { record: row, buffer };
  }

  /**
   * Generates a signed, expiring access token for safe temporary retrieval (GAR-039 §11)
   */
  generateSignedAccessToken(fileId: string, ttlSeconds = 3600): string {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${fileId}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64url');
  }

  /**
   * Verifies signed access token
   */
  verifySignedAccessToken(token: string): { fileId: string; valid: boolean } {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const [fileId, expiresAtStr, signature] = decoded.split(':');
      if (!fileId || !expiresAtStr || !signature) return { fileId: '', valid: false };

      const expiresAt = parseInt(expiresAtStr, 10);
      if (Math.floor(Date.now() / 1000) > expiresAt) {
        return { fileId, valid: false }; // expired
      }

      const expectedSig = crypto.createHmac('sha256', this.tokenSecret).update(`${fileId}:${expiresAtStr}`).digest('hex');
      return { fileId, valid: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig)) };
    } catch {
      return { fileId: '', valid: false };
    }
  }
}

export const storageEngine = new StorageEngine();
