import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { createCanonicalEventEnvelope } from '../../src/server/events/envelope';
import { enqueueOutboxEvent, OutboxWorker } from '../../src/server/events/outbox';
import { eventBus } from '../../src/server/events/eventBus';
import { withTransaction } from '../../src/server/database/transaction';
import { DataProvenanceClass } from '../../src/shared/provenance';

describe('Transactional Outbox Architecture (GAR-035)', () => {
  beforeEach(() => {
    resetDatabaseInstance();
    eventBus.clear();
  });

  it('enqueues outbox events atomically and dispatches to eventBus', async () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    let eventReceived = false;
    let receivedPayload: any = null;

    eventBus.subscribe('VehicleCreated', (evt) => {
      eventReceived = true;
      receivedPayload = evt.payload;
    });

    const envelope = createCanonicalEventEnvelope({
      type: 'VehicleCreated',
      correlation_id: 'corr_test_outbox',
      subject_ids: { vehicle_id: 'veh_test_01' },
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      payload: { make: 'Toyota', model: 'Hilux' },
    });

    // Enqueue inside transaction
    withTransaction((ctx) => {
      enqueueOutboxEvent(envelope, ctx.db);
    }, db);

    const worker = new OutboxWorker();
    const result = await worker.processBatch(10);

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(eventReceived, true);
    assert.equal(receivedPayload.make, 'Toyota');

    // Outbox status should now be PUBLISHED
    const row = db.prepare('SELECT status FROM outbox_events WHERE event_id = ?;').get(envelope.event_id) as { status: string };
    assert.equal(row.status, 'PUBLISHED');
  });
});
