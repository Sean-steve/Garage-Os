import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { seedDatabase } from '../../src/server/seed/devSeed';
import { authService } from '../../src/server/identity/authService';
import {
  assertProviderAccess,
  assertRealtimeTopicAccess,
} from '../../src/server/dispatch/dispatchAuthorization';
import { authenticate } from '../../src/server/api/authMiddleware';

describe('Phase R1 security reconciliation', () => {
  beforeEach(() => {
    resetDatabaseInstance();
    const db = getDatabase({ memory: true });
    runMigrations(db);
    seedDatabase(db);
  });

  it('prevents an owner from accessing a provider responder while allowing provider membership', () => {
    const owner = authService.getActorContextById('usr_seed_owner_01');
    const garageOwner = authService.getActorContextById('usr_seed_garage_owner');

    assert.ok(owner);
    assert.ok(garageOwner);

    assert.throws(() => assertProviderAccess(owner!, 'srv_seed_garage_01'));
    assert.doesNotThrow(() => assertProviderAccess(garageOwner!, 'srv_seed_garage_01'));

    assert.throws(() => assertRealtimeTopicAccess(owner!, 'responder.usr_seed_tech_01'));
    assert.doesNotThrow(() =>
      assertRealtimeTopicAccess(garageOwner!, 'responder.usr_seed_tech_01')
    );
  });

  it('restricts operations-wide realtime topics to platform operations actors', () => {
    const owner = authService.getActorContextById('usr_seed_owner_01');
    const admin = authService.getActorContextById('usr_seed_admin');

    assert.ok(owner);
    assert.ok(admin);

    assert.throws(() => assertRealtimeTopicAccess(owner!, 'operations.dispatch'));
    assert.doesNotThrow(() => assertRealtimeTopicAccess(admin!, 'operations.dispatch'));
  });

  it('does not trust X-Actor-Id unless the explicit development escape hatch is enabled', async () => {
    const middleware = authenticate();
    const req: any = {
      headers: {
        'x-actor-id': 'usr_seed_admin',
      },
    };

    let middlewareError: unknown;
    await new Promise<void>((resolve) => {
      middleware(req, {} as any, (err?: unknown) => {
        middlewareError = err;
        resolve();
      });
    });

    assert.equal(middlewareError, undefined);
    assert.ok(req.actor);
    assert.equal(req.actor.id, 'usr_seed_owner_01');
    assert.notEqual(req.actor.id, 'usr_seed_admin');
  });

  it('requires signed evidence tokens at the file route boundary', () => {
    const source = readFileSync(
      new URL('../../src/server/api/router.ts', import.meta.url),
      'utf8'
    );

    assert.match(source, /A signed access token is required for file retrieval/);
    assert.match(source, /verifySignedAccessToken\(token\)/);
  });

  it('does not commit runtime SQLite files in the R1 baseline', () => {
    const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
    assert.match(ignore, /data\/\*\.db/);
    assert.match(ignore, /data\/\*\.db-wal/);
    assert.match(ignore, /data\/\*\.db-shm/);
  });
});
