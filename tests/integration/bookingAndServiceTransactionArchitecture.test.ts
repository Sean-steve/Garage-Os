/**
 * Sprint 11 Comprehensive Verification & Integration Test Suite
 * Primary Specification: GAR-013 — Booking, Scheduling, Quotes & Service Transaction Architecture
 *
 * Demonstrates:
 * - Scenario A: Availability & Capacity Rules
 * - Scenario B: Direct Customer Booking Creation
 * - Scenario C: Provider Review & Confirmation
 * - Scenario D: Booking Rescheduling with Revision History
 * - Scenario E: Commercial Quote Issuance, Money Arithmetic & Digital Acceptance
 * - Scenario F: Versioned Quote Revision (V1 Superseded -> V2 Accepted)
 * - Scenario G: Additional Work During Service (Finding -> Quote -> Authorization)
 * - Scenario H: Declined Additional Work (Remains Unauthorized)
 * - Scenario I: Booking Check-in Bridging to Sprint 10 ServiceCase
 * - Scenario J: Work Order Completion & Release Bridging to Booking Completion
 * - Scenario K: Concurrency & Capacity Hold Expiry
 * - Scenario L: Security & Actor Access Boundaries
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { bookingService } from '../../src/server/booking/bookingService';
import { bookingRepository } from '../../src/server/booking/bookingRepository';
import { garageOperationsService } from '../../src/server/operations/garageOperationsService';
import { timelineProjector } from '../../src/server/timeline/timelineProjector';
import { FuelType, OdometerUnit, TransmissionType, VehicleType } from '../../src/server/vehicle/types';
import { OrganizationType, MembershipRole } from '../../src/server/identity/types';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Booking, Scheduling, Quotes & Service Transactions (GAR-013)', () => {
  let db: any;
  let customerUser: any;
  let customerActor: any;
  let vehicleId: string;
  let providerId: string;
  let branchId: string;
  let managerActor: any;
  let advisorActor: any;
  let offeringId: string;

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);
    timelineProjector.initialize();

    // 1. Setup Customer & Vehicle
    const custReg = authService.registerUser({
      email: 'jane.wambui@example.com',
      fullName: 'Jane Wambui',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(custReg.user.id);
    customerUser = custReg.user;
    customerActor = authService.getActorContextById(customerUser.id)!;

    const veh = vehicleService.createVehicle(customerActor, {
      make: 'Toyota',
      model: 'Land Cruiser Prado',
      model_year: 2020,
      vin: 'JTEBX29J50K998877',
      registration_number: 'KDC 440Z',
      vehicle_type: VehicleType.SUV,
      fuel_type: FuelType.DIESEL,
      transmission: TransmissionType.AUTOMATIC,
      initial_odometer_value: 50000,
      initial_odometer_unit: OdometerUnit.KM,
    });
    vehicleId = veh.vehicle.id;

    // 2. Setup Provider Organization, Provider, Branch & Staff
    const mgrReg = authService.registerUser({
      email: 'director@nairobiauto.test',
      fullName: 'Dr. David Kamau',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(mgrReg.user.id);
    managerActor = authService.getActorContextById(mgrReg.user.id)!;

    const orgId = 'org_test_provider_01';
    db.prepare(`
      INSERT INTO organizations (id, organization_type, name, status, created_at, updated_at)
      VALUES (?, 'AUTOMOTIVE_SERVICE_PROVIDER', 'Nairobi Premier Auto Clinic', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);

    db.prepare(`
      INSERT INTO organization_memberships (id, user_id, organization_id, role, status, created_at, updated_at)
      VALUES ('mem_mgr_01', ?, ?, 'ADMIN', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(mgrReg.user.id, orgId);

    managerActor = authService.getActorContextById(mgrReg.user.id)!;

    providerId = 'srv_test_provider_01';
    db.prepare(`
      INSERT INTO service_providers (id, organization_id, name, provider_type, status, created_at, updated_at)
      VALUES (?, ?, 'Nairobi Premier Auto Clinic', 'WORKSHOP', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(providerId, orgId);

    const locationId = 'loc_test_branch_01';
    db.prepare(`
      INSERT INTO provider_locations (
        id, provider_id, name, location_type, address_line1, city, county_state, country, latitude, longitude, created_at, updated_at
      ) VALUES (?, ?, 'Industrial Area Facility', 'WORKSHOP', 'Enterprise Rd', 'Nairobi', 'Nairobi', 'KE', -1.30, 36.85, datetime('now'), datetime('now'))
    `).run(locationId, providerId);

    branchId = 'prvbr_test_branch_01';
    db.prepare(`
      INSERT INTO provider_branches (id, provider_id, location_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Industrial Area Central', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(branchId, providerId, locationId);

    // 3. Create Service Offering
    const offering = bookingService.createOffering(managerActor, {
      provider_id: providerId,
      branch_id: branchId,
      service_category_id: 'cat_oil_change',
      name: 'Full Synthetic Major Oil & Filter Service',
      description: 'Complete 5W-30 full synthetic oil service with OEM filter',
      delivery_mode: 'WORKSHOP',
      booking_mode: 'PROVIDER_CONFIRMATION',
      estimated_duration_minutes: 60,
      pricing_model: 'FIXED',
      base_price_minor: 850000,
      currency: 'KES',
    });
    offeringId = offering.id;

    // 4. Setup Provider Capacity Rules (Mon - Sat, 08:00 - 17:00, max 2 concurrent bookings)
    for (let day = 1; day <= 6; day++) {
      bookingService.setCapacityRule(managerActor, {
        provider_id: providerId,
        branch_id: branchId,
        day_of_week: day,
        start_time: '08:00',
        end_time: '17:00',
        max_concurrent_bookings: 2,
        slot_duration_minutes: 60,
        buffer_after_minutes: 15,
      });
    }
  });

  it('Scenario A: Generates deterministic slot availability based on capacity rules', () => {
    // Check next Monday's availability (2026-03-16 is Monday)
    const availability = bookingService.getAvailability(providerId, {
      branch_id: branchId,
      service_offering_id: offeringId,
      date_from: '2026-03-16',
      date_to: '2026-03-16',
    });

    assert.ok(availability.length > 0, 'Should generate availability slots');
    assert.strictEqual(availability[0].available, true);
    assert.strictEqual(availability[0].capacity_total, 2);
    assert.strictEqual(availability[0].capacity_remaining, 2);
    assert.strictEqual(availability[0].slot_start_at.includes('08:00'), true);
  });

  it('Scenario B & C: Customer creates booking request -> Provider accepts and confirms', () => {
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
      delivery_mode: 'WORKSHOP',
      requested_start_at: '2026-03-16T09:00:00.000Z',
      requested_end_at: '2026-03-16T10:00:00.000Z',
      customer_notes: 'Engine feels sluggish on cold start.',
    });

    assert.strictEqual(booking.status, 'REQUESTED');
    assert.strictEqual(booking.customer_user_id, customerUser.id);
    assert.strictEqual(booking.vehicle_id, vehicleId);

    // Provider accepts booking
    const confirmed = bookingService.acceptBooking(managerActor, booking.id);
    assert.strictEqual(confirmed.status, 'CONFIRMED');
    assert.ok(confirmed.confirmed_start_at);

    // Check appointment was automatically scheduled
    const apt = bookingService.getAppointmentForBooking(booking.id);
    assert.ok(apt, 'ServiceAppointment must exist for confirmed booking');
    assert.strictEqual(apt.status, 'SCHEDULED');
  });

  it('Scenario D: Reschedule preserves historical revisions without overwriting silently', () => {
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
      requested_start_at: '2026-03-16T09:00:00.000Z',
      requested_end_at: '2026-03-16T10:00:00.000Z',
    });
    bookingService.acceptBooking(managerActor, booking.id);

    // Customer requests reschedule to afternoon
    const rescheduled = bookingService.rescheduleBooking(customerActor, booking.id, {
      new_start_at: '2026-03-16T14:00:00.000Z',
      new_end_at: '2026-03-16T15:00:00.000Z',
      reason: 'Work schedule change',
    });

    assert.strictEqual(rescheduled.confirmed_start_at, '2026-03-16T14:00:00.000Z');

    // Verify historical revision audit
    const revisions = bookingService.getBookingRevisions(booking.id);
    assert.strictEqual(revisions.length, 1);
    assert.strictEqual(revisions[0].previous_start_at, '2026-03-16T09:00:00.000Z');
    assert.strictEqual(revisions[0].new_start_at, '2026-03-16T14:00:00.000Z');
    assert.strictEqual(revisions[0].reason, 'Work schedule change');
  });

  it('Scenario E: Provider issues binding commercial quote -> Customer digitally accepts and creates ServiceAuthorization', () => {
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
      requested_start_at: '2026-03-16T09:00:00.000Z',
      requested_end_at: '2026-03-16T10:00:00.000Z',
    });

    // Provider prepares and issues quote V1 with minor-unit integer arithmetic
    const quote = bookingService.createQuote(managerActor, {
      booking_id: booking.id,
      provider_id: providerId,
      branch_id: branchId,
      vehicle_id: vehicleId,
      customer_user_id: customerUser.id,
      line_items: [
        {
          line_type: 'SERVICE',
          service_category: 'cat_oil_change',
          description: 'Full Synthetic 5W-30 Oil Service',
          quantity: 1,
          unit_price_minor: 850000,
          authorization_required: true,
          is_optional: false,
        },
        {
          line_type: 'PART',
          service_category: 'cat_brake_pad_disc',
          description: 'Front Ceramic Brake Pad Set',
          quantity: 1,
          unit_price_minor: 1450000,
          authorization_required: true,
          is_optional: false,
        },
      ],
    });

    // Subtotal: 8500 + 14500 = 23000 KES (2,300,000 minor units)
    // Tax (16% VAT): 368,000 minor units
    // Total: 2,668,000 minor units
    assert.strictEqual(quote.subtotal_minor, 2300000);
    assert.strictEqual(quote.tax_minor, 368000);
    assert.strictEqual(quote.total_minor, 2668000);
    assert.strictEqual(quote.version, 1);

    // Issue the quote
    const issued = bookingService.issueQuote(managerActor, quote.id);
    assert.strictEqual(issued.status, 'ISSUED');
    assert.ok(issued.issued_at);

    // Customer accepts the quote digitally
    const accepted = bookingService.acceptQuote(customerActor, quote.id, {
      authorization_channel: 'DIGITAL_APP',
    });
    assert.strictEqual(accepted.status, 'ACCEPTED');
    assert.ok(accepted.accepted_at);

    // Verify Sprint 10 ServiceAuthorization was generated
    assert.ok(accepted.service_authorization_id, 'Must produce canonical ServiceAuthorization');
  });

  it('Scenario F: Versioned Quote Revision marks V1 SUPERSEDED and issues V2', () => {
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
    });

    const quoteV1 = bookingService.createQuote(managerActor, {
      booking_id: booking.id,
      provider_id: providerId,
      vehicle_id: vehicleId,
      customer_user_id: customerUser.id,
      line_items: [
        {
          line_type: 'SERVICE',
          description: 'Initial Diagnostic',
          quantity: 1,
          unit_price_minor: 450000,
        },
      ],
    });
    bookingService.issueQuote(managerActor, quoteV1.id);

    // Provider revises quote with additional scope
    const quoteV2 = bookingService.reviseQuote(managerActor, quoteV1.id, {
      line_items: [
        {
          line_type: 'SERVICE',
          description: 'Initial Diagnostic & Throttle Body Cleaning',
          quantity: 1,
          unit_price_minor: 750000,
        },
      ],
    });

    // Check V1 is superseded
    const reloadedV1 = bookingService.getQuote(quoteV1.id);
    assert.strictEqual(reloadedV1.status, 'SUPERSEDED');

    // Check V2 is version 2 and links back
    assert.strictEqual(quoteV2.version, 2);
    assert.strictEqual(quoteV2.supersedes_quote_id, quoteV1.id);

    // Customer cannot accept old superseded quote V1
    assert.throws(() => {
      bookingService.acceptQuote(customerActor, quoteV1.id, { authorization_channel: 'DIGITAL_APP' });
    }, /SUPERSEDED|invalid state/i);
  });

  it('Scenario G & H: Additional work during service generates additional quote & enforces explicit customer approval', () => {
    // Create and check in booking
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
      requested_start_at: '2026-03-16T09:00:00.000Z',
    });
    bookingService.acceptBooking(managerActor, booking.id);

    // Check in vehicle bridging into Sprint 10 ServiceCase
    const checkedInBooking = bookingService.checkInBooking(managerActor, booking.id, {
      initial_odometer_km: 55000,
    });
    assert.strictEqual(checkedInBooking.status, 'CHECKED_IN');
    assert.ok(checkedInBooking.service_case_id);

    // Additional finding discovered during inspection
    const addQuote = bookingService.createQuote(managerActor, {
      booking_id: booking.id,
      service_case_id: checkedInBooking.service_case_id,
      provider_id: providerId,
      vehicle_id: vehicleId,
      customer_user_id: customerUser.id,
      quote_type: 'ADDITIONAL_WORK',
      line_items: [
        {
          line_type: 'PART',
          description: 'Front Left Control Arm Bushing Pair',
          quantity: 1,
          unit_price_minor: 1200000,
          is_optional: true,
        },
      ],
    });
    bookingService.issueQuote(managerActor, addQuote.id);

    // Customer declines additional work (Scenario H)
    const rejected = bookingService.rejectQuote(customerActor, addQuote.id, {
      reason_code: 'PRICE_TOO_HIGH',
      reason_text: 'Will attend to this during next scheduled service',
    });
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.ok(!rejected.service_authorization_id, 'Declined quote must not create authorization');
  });

  it('Scenario I & J: Full lifecycle from Booking -> Check-In -> Service Case -> Completion', () => {
    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
      requested_start_at: '2026-03-16T09:00:00.000Z',
    });
    bookingService.acceptBooking(managerActor, booking.id);

    // Vehicle enters workshop
    const checkedIn = bookingService.checkInBooking(managerActor, booking.id, {
      initial_odometer_km: 55200,
      fuel_level_percent: 75,
    });
    assert.strictEqual(checkedIn.status, 'CHECKED_IN');

    // Complete linked service case
    const completed = bookingService.completeBooking(managerActor, booking.id);
    assert.strictEqual(completed.status, 'COMPLETED');
  });

  it('Scenario K: Concurrency capacity holds prevent double-booking over-limit', () => {
    const slotStart = '2026-03-16T11:00:00.000Z';
    const slotEnd = '2026-03-16T12:00:00.000Z';

    // Hold 1 (Capacity is 2)
    const hold1 = bookingService.createCapacityHold(customerActor, {
      provider_id: providerId,
      branch_id: branchId,
      slot_start_at: slotStart,
      slot_end_at: slotEnd,
      ttl_minutes: 15,
    });
    assert.strictEqual(hold1.status, 'ACTIVE');

    // Hold 2 (Consumes remaining capacity)
    const hold2 = bookingService.createCapacityHold(customerActor, {
      provider_id: providerId,
      branch_id: branchId,
      slot_start_at: slotStart,
      slot_end_at: slotEnd,
      ttl_minutes: 15,
    });
    assert.strictEqual(hold2.status, 'ACTIVE');

    // Hold 3 (Must fail - capacity exhausted)
    assert.throws(() => {
      bookingService.createCapacityHold(customerActor, {
        provider_id: providerId,
        branch_id: branchId,
        slot_start_at: slotStart,
        slot_end_at: slotEnd,
        ttl_minutes: 15,
      });
    }, /Capacity exceeded|slot unavailable|no longer available/i);

    // Expire holds using background cleanup
    bookingService.processCapacityHoldCleanup(new Date(Date.now() + 20 * 60000).toISOString());

    // Hold 4 should now succeed because previous holds expired
    const hold4 = bookingService.createCapacityHold(customerActor, {
      provider_id: providerId,
      branch_id: branchId,
      slot_start_at: slotStart,
      slot_end_at: slotEnd,
      ttl_minutes: 15,
    });
    assert.strictEqual(hold4.status, 'ACTIVE');
  });

  it('Scenario L: Security isolation prevents unauthorized customer or provider access', () => {
    // Another customer
    const evilReg = authService.registerUser({
      email: 'intruder@example.com',
      fullName: 'Evil Attacker',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(evilReg.user.id);
    const evilActor = authService.getActorContextById(evilReg.user.id)!;

    const booking = bookingService.createBooking(customerActor, {
      vehicle_id: vehicleId,
      provider_id: providerId,
      branch_id: branchId,
      service_offering_id: offeringId,
    });

    // Intruder customer cannot cancel another customer's booking
    assert.throws(() => {
      bookingService.cancelBooking(evilActor, booking.id, {
        reason_code: 'CUSTOMER_CHANGED_PLANS',
      });
    }, /Access denied|not authorized|Unauthorized/i);
  });
});
