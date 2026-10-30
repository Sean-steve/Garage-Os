import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { storageEngine } from '../../src/server/storage/storageEngine';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Object Storage Architecture (GAR-038)', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  it('stores valid documents and generates verifiable signed access tokens', async () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    const testBuffer = Buffer.from('PDF Mock Content for Vehicle Service Invoice');
    const record = await storageEngine.storeFile({
      filename: 'invoice_101.pdf',
      contentType: 'application/pdf',
      buffer: testBuffer,
      ownerId: 'usr_owner_1',
    });

    assert.ok(record.id);
    assert.equal(record.filename, 'invoice_101.pdf');
    assert.equal(record.scan_status, 'AVAILABLE');

    // Retrieve file
    const retrieved = await storageEngine.getFile(record.id);
    assert.ok(retrieved);
    assert.equal(retrieved.buffer.toString(), 'PDF Mock Content for Vehicle Service Invoice');

    // Test signed token
    const token = storageEngine.generateSignedAccessToken(record.id, 60);
    assert.equal(typeof token, 'string');

    const verified = storageEngine.verifySignedAccessToken(token);
    assert.equal(verified.valid, true);
    assert.equal(verified.fileId, record.id);
  });

  it('rejects forbidden file types like executables or HTML', async () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    await assert.rejects(
      () =>
        storageEngine.storeFile({
          filename: 'malicious.exe',
          contentType: 'application/x-msdownload',
          buffer: Buffer.from('bad'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });
});
