/**
 * Sprint 14 Comprehensive Verification & Integration Test Suite
 * Primary Specification: GAR-016 — Real-Time Dispatch, Location & Provider Matching Architecture
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { locationService } from '../../src/server/dispatch/locationService';
import { matchingEngine } from '../../src/server/dispatch/matchingEngine';
import { dispatchService } from '../../src/server/dispatch/dispatchService';
import { dispatchRepository } from '../../src/server/dispatch/dispatchRepository';
import { routingService } from '../../src/server/dispatch/routingService';
import { dispatchWorker } from '../../src/server/dispatch/dispatchWorker';
import {
  DispatchDomain,
  DispatchPriority,
  DispatchStrategy,
  DispatchRequestStatus,
  DispatchAttemptStatus,
  ResponderType,
  ResponderAvailabilityStatus,
  LocationSourceType,
  LocationFreshness,
  TrackingAccessStatus,
} from '../../src/server/dispatch/types';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Real-Time Dispatch, Location & Provider Matching (GAR-016)', () => {
  let db: any;

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);

    // Setup base provider seed for test
    db.prepare(`
      INSERT OR IGNORE INTO service_providers (
        id, name, provider_type, phone, email, status, verification_state, created_at, updated_at
      ) VALUES
      ('prv_01', 'Apex Mechanics Ltd', 'GARAGE', '+254700000001', 'apex@test.local', 'ACTIVE', 'VERIFIED', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('prv_02', 'Boma Recovery Ltd', 'TOW_OPERATOR', '+254700000002', 'boma@test.local', 'ACTIVE', 'VERIFIED', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `).run();
  });

  describe('1. Location & Telemetry Ingestion Engine', () => {
    it('ingests valid GPS observation and updates current location projection', () => {
      const now = new Date().toISOString();
      const res = locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_01',
          latitude: -1.286389,
          longitude: 36.817223,
          accuracy_meters: 10.5,
          speed_meters_per_second: 5.0,
          captured_at: now,
          source_type: LocationSourceType.DEVICE_GPS,
        },
        db
      );

      assert.strictEqual(res.observation.is_outlier, 0);
      assert.strictEqual(res.currentProjectionUpdated, true);

      const current = locationService.getCurrentLocation('tech_01', db);
      assert.ok(current);
      assert.strictEqual(current.latitude, -1.286389);
      assert.strictEqual(current.longitude, 36.817223);
      assert.strictEqual(current.freshness_state, LocationFreshness.FRESH);
    });

    it('detects impossible teleportation jump (> 160 km/h) and flags as outlier', () => {
      const t1 = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
      locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_teleport',
          latitude: -1.286389,
          longitude: 36.817223,
          captured_at: t1,
        },
        db
      );

      // Now jump 100 km away in just 60 seconds (6000 km/h)
      const t2 = new Date().toISOString();
      const res2 = locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_teleport',
          latitude: -0.386389, // ~100 km north
          longitude: 36.817223,
          captured_at: t2,
        },
        db
      );

      assert.strictEqual(res2.observation.is_outlier, 1);
      assert.ok(res2.observation.outlier_reason?.includes('IMPOSSIBLE_SPEED'));
      assert.strictEqual(res2.currentProjectionUpdated, false);

      // Current location projection should remain at original coordinate
      const current = locationService.getCurrentLocation('tech_teleport', db);
      assert.strictEqual(current?.latitude, -1.286389);
    });

    it('rejects out-of-order telemetry packets', () => {
      const tRecent = new Date().toISOString();
      const tOld = new Date(Date.now() - 120 * 1000).toISOString();

      locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_order',
          latitude: -1.286389,
          longitude: 36.817223,
          captured_at: tRecent,
        },
        db
      );

      const resOld = locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_order',
          latitude: -1.287,
          longitude: 36.818,
          captured_at: tOld,
        },
        db
      );

      assert.strictEqual(resOld.observation.is_outlier, 1);
      assert.strictEqual(resOld.observation.outlier_reason, 'OUT_OF_ORDER_TIMESTAMP');
      assert.strictEqual(resOld.currentProjectionUpdated, false);
    });
  });

  describe('2. Presence & Background Staleness Worker', () => {
    it('tracks presence and detects stale heartbeats (> 180s)', async () => {
      // Setup responder with heartbeat 200s ago
      const staleHeartbeat = new Date(Date.now() - 200 * 1000).toISOString();
      locationService.updatePresence(
        {
          provider_id: 'prv_01',
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_ghost',
          status: ResponderAvailabilityStatus.AVAILABLE,
        },
        db
      );

      db.prepare(`
        UPDATE responder_presence
        SET last_heartbeat_at = ?
        WHERE responder_reference_id = 'tech_ghost';
      `).run(staleHeartbeat);

      // Run worker evaluation cycle
      await dispatchWorker.runEvaluationCycle(db);

      const presence = locationService.getPresence('tech_ghost', db);
      assert.strictEqual(presence?.status, ResponderAvailabilityStatus.UNKNOWN);
    });
  });

  describe('3. Matching Engine & Multi-Factor Scoring', () => {
    it('discovers and scores candidates based on capability, proximity, and freshness', async () => {
      const now = new Date().toISOString();

      // Seed candidate 1: close (1.5 km), fresh GPS, AVAILABLE
      locationService.updatePresence(
        {
          provider_id: 'prv_01',
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_close',
          status: ResponderAvailabilityStatus.AVAILABLE,
        },
        db
      );
      locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_close',
          latitude: -1.280,
          longitude: 36.815,
          captured_at: now,
        },
        db
      );

      // Seed candidate 2: farther (6 km), fresh GPS, AVAILABLE
      locationService.updatePresence(
        {
          provider_id: 'prv_01',
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_far',
          status: ResponderAvailabilityStatus.AVAILABLE,
        },
        db
      );
      locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_far',
          latitude: -1.330,
          longitude: 36.820,
          captured_at: now,
        },
        db
      );

      // Seed candidate 3: ON_JOB (should be excluded)
      locationService.updatePresence(
        {
          provider_id: 'prv_01',
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_busy',
          status: ResponderAvailabilityStatus.ON_JOB,
        },
        db
      );

      const candidates = await matchingEngine.evaluateCandidates(
        {
          dispatchRequestId: 'dr_test_01',
          dispatchAttemptId: 'da_test_01',
          domain: DispatchDomain.ROADSIDE,
          requiredCapability: 'TIRE_CHANGE',
          pickupLatitude: -1.286389,
          pickupLongitude: 36.817223,
          searchRadiusKm: 10.0,
        },
        db
      );

      assert.ok(candidates.length >= 2);
      const eligible = candidates.filter((c) => c.eligibility_status === 'ELIGIBLE');
      assert.strictEqual(eligible.length, 2);

      // Closer technician must have higher overall score and Rank 1
      assert.strictEqual(eligible[0].responder_reference_id, 'tech_close');
      assert.strictEqual(eligible[0].rank, 1);
      assert.ok(eligible[0].overall_score > eligible[1].overall_score);
    });
  });

  describe('4. Dispatch Flow & Concurrency Safe Acceptance', () => {
    it('creates request, offers to candidates, and commits atomic acceptance', async () => {
      const now = new Date().toISOString();

      // Seed responder
      locationService.updatePresence(
        {
          provider_id: 'prv_01',
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_accept_test',
          status: ResponderAvailabilityStatus.AVAILABLE,
        },
        db
      );
      locationService.ingestObservation(
        {
          responder_type: ResponderType.PROVIDER_STAFF,
          responder_reference_id: 'tech_accept_test',
          latitude: -1.287,
          longitude: 36.818,
          captured_at: now,
        },
        db
      );

      // Seed driver user and vehicle
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, full_name, role, status, created_at, updated_at)
        VALUES ('usr_driver_01', 'driver@test.local', 'Test Driver', 'VEHICLE_OWNER', 'ACTIVE', ?, ?);
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO vehicles (id, owner_id, display_name, vin, make, model, model_year, status, created_at, updated_at)
        VALUES ('veh_01', 'usr_driver_01', 'Hilux', 'VIN12345678901234', 'Toyota', 'Hilux', 2022, 'ACTIVE', ?, ?);
      `).run(now, now);

      // Create incident in DB to satisfy adapter link
      db.prepare(`
        INSERT INTO roadside_incidents (
          id, incident_number, vehicle_id, reported_by_user_id, reported_by_name,
          incident_type, severity, status, created_at, updated_at
        ) VALUES (
          'inc_test_01', 'INC-001', 'veh_01', 'usr_driver_01', 'Test Driver',
          'FLAT_TIRE', 'ROUTINE', 'REPORTED',
          ?, ?
        );
      `).run(now, now);

      db.prepare(`
        INSERT INTO roadside_assistance_requests (
          id, incident_id, requested_assistance_type, status, created_at
        ) VALUES (
          'rsr_test_01', 'inc_test_01', 'TIRE_CHANGE', 'BROADCASTING', ?
        );
      `).run(now);

      // 1. Create dispatch request
      const { request, attempt, candidates } = await dispatchService.createRequest(
        {
          dispatch_domain: DispatchDomain.ROADSIDE,
          source_reference_type: 'ROADSIDE_ASSISTANCE_REQUEST',
          source_reference_id: 'rsr_test_01',
          required_capability: 'TIRE_CHANGE',
          pickup_latitude: -1.286389,
          pickup_longitude: 36.817223,
          priority: DispatchPriority.NORMAL,
          strategy: DispatchStrategy.BATCH,
        },
        db
      );

      assert.strictEqual(request.status, DispatchRequestStatus.OFFERING);
      assert.ok(candidates.length > 0);

      // Retrieve created offer from DB
      const offer = db.prepare(`
        SELECT * FROM roadside_provider_offers WHERE incident_id = 'inc_test_01';
      `).get() as any;
      assert.ok(offer);

      // 2. Accept offer atomically
      const acceptResult = await dispatchService.acceptOffer({
        dispatchRequestId: request.id,
        offerId: offer.id,
        responderReferenceId: 'tech_accept_test',
        actor: { id: 'tech_accept_test', role: 'PROVIDER_STAFF', name: 'John Tech' },
        customDb: db,
      });

      assert.strictEqual(acceptResult.request.status, DispatchRequestStatus.ASSIGNED);
      assert.strictEqual(acceptResult.request.assigned_responder_id, 'tech_accept_test');

      // Verify responder presence transitioned to ON_JOB
      const presence = locationService.getPresence('tech_accept_test', db);
      assert.strictEqual(presence?.status, ResponderAvailabilityStatus.ON_JOB);

      // 3. Concurrency check: duplicate acceptance must throw CONFLICT
      assert.rejects(
        async () => {
          await dispatchService.acceptOffer({
            dispatchRequestId: request.id,
            offerId: offer.id,
            responderReferenceId: 'tech_accept_test',
            actor: { id: 'other_tech', role: 'PROVIDER_STAFF' },
            customDb: db,
          });
        },
        (err: any) => err.statusCode === 409
      );
    });
  });

  describe('5. Privacy-Guarded Customer Tracking & Reassignment', () => {
    it('provides live coordinates when active and redacts when revoked', () => {
      const now = new Date().toISOString();

      // Seed dummy dispatch request first to satisfy foreign key
      db.prepare(`
        INSERT INTO dispatch_requests (
          id, dispatch_domain, source_reference_type, source_reference_id,
          required_capability, pickup_latitude, pickup_longitude, status,
          strategy, strategy_version, created_at, updated_at
        ) VALUES (
          'dr_priv_01', 'ROADSIDE', 'INCIDENT', 'inc_priv_01',
          'TIRE_CHANGE', -1.286, 36.817, 'ASSIGNED',
          'BATCH', 'v1.0', ?, ?
        );
      `).run(now, now);

      // Seed tracking projection
      dispatchRepository.saveTrackingProjection(
        {
          id: 'dtp_test_01',
          dispatch_request_id: 'dr_priv_01',
          assignment_id: 'asg_priv_01',
          assignment_domain: DispatchDomain.ROADSIDE,
          assignment_status: 'EN_ROUTE',
          responder_display_name: 'David Responder',
          responder_unit_summary: 'Mobile Unit 4',
          latitude: -1.286,
          longitude: 36.817,
          accuracy_meters: 10,
          location_freshness: LocationFreshness.FRESH,
          location_captured_at: now,
          eta_arrival_at: new Date(Date.now() + 600 * 1000).toISOString(),
          eta_duration_seconds: 600,
          eta_source: 'ROUTING_ENGINE',
          eta_calculated_at: now,
          eta_freshness: LocationFreshness.FRESH,
          tracking_access_status: TrackingAccessStatus.ACTIVE,
          is_tracking_active: 1,
          last_updated_at: now,
        },
        db
      );

      // Active view contains coordinates
      const activeView = dispatchService.getTrackingView({
        assignmentId: 'asg_priv_01',
        requesterUserId: 'customer_123',
        customDb: db,
      });
      assert.strictEqual(activeView.latitude, -1.286);
      assert.strictEqual(activeView.longitude, 36.817);

      // Revoke tracking access
      db.prepare(`
        UPDATE dispatch_tracking_projections
        SET tracking_access_status = 'REVOKED'
        WHERE id = 'dtp_test_01';
      `).run();

      // Revoked view must redact GPS coordinates
      const revokedView = dispatchService.getTrackingView({
        assignmentId: 'asg_priv_01',
        requesterUserId: 'customer_123',
        customDb: db,
      });
      assert.strictEqual(revokedView.latitude, null);
      assert.strictEqual(revokedView.longitude, null);
      assert.strictEqual(revokedView.warning_message, 'Tracking session has ended.');
    });
  });
});
