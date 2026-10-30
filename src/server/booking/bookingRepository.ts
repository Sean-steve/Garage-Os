/**
 * GAR-013: Booking, Scheduling, Quotes & Service Transaction Architecture
 * Repository Layer (SQLite typed data access)
 */

import { getDatabase } from '../database/connection';
import {
  ServiceOffering,
  ProviderCapacityRule,
  ProviderScheduleBlock,
  CapacityHold,
  Booking,
  BookingItem,
  ServiceAppointment,
  BookingScheduleRevision,
  BookingCancellation,
  ServiceEstimate,
  EstimateLineItem,
  ServiceQuote,
  QuoteLineItem,
  QuoteAcceptance,
  QuoteAcceptanceItem,
  QuoteRejection,
  BookingActivity,
  BookingStatus,
  QuoteStatus,
} from './types';

export class BookingRepository {
  private db() {
    return getDatabase();
  }

  // ==========================================
  // 1. Service Offerings
  // ==========================================

  getServiceOfferingById(id: string): ServiceOffering | null {
    const row = this.db()
      .prepare('SELECT * FROM service_offerings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapServiceOffering(row);
  }

  listServiceOfferings(filters: {
    provider_id?: string;
    branch_id?: string;
    service_category_id?: string;
    status?: string;
  }): ServiceOffering[] {
    let sql = 'SELECT * FROM service_offerings WHERE 1=1';
    const params: any[] = [];

    if (filters.provider_id) {
      sql += ' AND provider_id = ?';
      params.push(filters.provider_id);
    }
    if (filters.branch_id) {
      sql += ' AND branch_id = ?';
      params.push(filters.branch_id);
    }
    if (filters.service_category_id) {
      sql += ' AND service_category_id = ?';
      params.push(filters.service_category_id);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY name ASC';
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => this.mapServiceOffering(r));
  }

  saveServiceOffering(offering: ServiceOffering): void {
    this.db()
      .prepare(
        `INSERT INTO service_offerings (
          id, provider_id, branch_id, service_category_id, capability_id, name, description,
          delivery_mode, booking_mode, estimated_duration_minutes, pricing_model, base_price_minor,
          currency, requires_inspection, requires_quote, requires_vehicle, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          branch_id=excluded.branch_id,
          name=excluded.name,
          description=excluded.description,
          delivery_mode=excluded.delivery_mode,
          booking_mode=excluded.booking_mode,
          estimated_duration_minutes=excluded.estimated_duration_minutes,
          pricing_model=excluded.pricing_model,
          base_price_minor=excluded.base_price_minor,
          currency=excluded.currency,
          requires_inspection=excluded.requires_inspection,
          requires_quote=excluded.requires_quote,
          requires_vehicle=excluded.requires_vehicle,
          status=excluded.status,
          updated_at=excluded.updated_at`
      )
      .run(
        offering.id,
        offering.provider_id,
        offering.branch_id ?? null,
        offering.service_category_id,
        offering.capability_id ?? null,
        offering.name,
        offering.description ?? null,
        offering.delivery_mode,
        offering.booking_mode,
        offering.estimated_duration_minutes ?? null,
        offering.pricing_model,
        offering.base_price_minor ?? null,
        offering.currency,
        offering.requires_inspection ? 1 : 0,
        offering.requires_quote ? 1 : 0,
        offering.requires_vehicle ? 1 : 0,
        offering.status,
        offering.created_at,
        offering.updated_at
      );
  }

  private mapServiceOffering(row: Record<string, unknown>): ServiceOffering {
    return {
      id: String(row.id),
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      service_category_id: String(row.service_category_id),
      capability_id: row.capability_id ? String(row.capability_id) : null,
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      delivery_mode: row.delivery_mode as any,
      booking_mode: row.booking_mode as any,
      estimated_duration_minutes: row.estimated_duration_minutes ? Number(row.estimated_duration_minutes) : null,
      pricing_model: row.pricing_model as any,
      base_price_minor: row.base_price_minor !== null ? Number(row.base_price_minor) : null,
      currency: String(row.currency || 'KES'),
      requires_inspection: Boolean(row.requires_inspection),
      requires_quote: Boolean(row.requires_quote),
      requires_vehicle: Boolean(row.requires_vehicle),
      status: row.status as any,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  // ==========================================
  // 2. Capacity Rules & Schedule Blocks
  // ==========================================

  getCapacityRules(provider_id: string, branch_id?: string | null): ProviderCapacityRule[] {
    let sql = 'SELECT * FROM provider_capacity_rules WHERE provider_id = ? AND is_active = 1';
    const params: any[] = [provider_id];
    if (branch_id) {
      sql += ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branch_id);
    }
    sql += ' ORDER BY day_of_week ASC, start_time ASC';
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      provider_id: String(r.provider_id),
      branch_id: r.branch_id ? String(r.branch_id) : null,
      service_category_id: r.service_category_id ? String(r.service_category_id) : null,
      day_of_week: Number(r.day_of_week),
      start_time: String(r.start_time),
      end_time: String(r.end_time),
      max_concurrent_bookings: Number(r.max_concurrent_bookings),
      slot_duration_minutes: Number(r.slot_duration_minutes),
      buffer_before_minutes: Number(r.buffer_before_minutes),
      buffer_after_minutes: Number(r.buffer_after_minutes),
      minimum_notice_minutes: Number(r.minimum_notice_minutes),
      max_advance_days: Number(r.max_advance_days),
      timezone: String(r.timezone || 'Africa/Nairobi'),
      effective_from: r.effective_from ? String(r.effective_from) : null,
      effective_to: r.effective_to ? String(r.effective_to) : null,
      is_active: Boolean(r.is_active),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  saveCapacityRule(rule: ProviderCapacityRule): void {
    this.db()
      .prepare(
        `INSERT INTO provider_capacity_rules (
          id, provider_id, branch_id, service_category_id, day_of_week, start_time, end_time,
          max_concurrent_bookings, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes,
          minimum_notice_minutes, max_advance_days, timezone, effective_from, effective_to, is_active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          day_of_week=excluded.day_of_week,
          start_time=excluded.start_time,
          end_time=excluded.end_time,
          max_concurrent_bookings=excluded.max_concurrent_bookings,
          slot_duration_minutes=excluded.slot_duration_minutes,
          buffer_before_minutes=excluded.buffer_before_minutes,
          buffer_after_minutes=excluded.buffer_after_minutes,
          minimum_notice_minutes=excluded.minimum_notice_minutes,
          max_advance_days=excluded.max_advance_days,
          is_active=excluded.is_active,
          updated_at=excluded.updated_at`
      )
      .run(
        rule.id,
        rule.provider_id,
        rule.branch_id ?? null,
        rule.service_category_id ?? null,
        rule.day_of_week,
        rule.start_time,
        rule.end_time,
        rule.max_concurrent_bookings,
        rule.slot_duration_minutes,
        rule.buffer_before_minutes,
        rule.buffer_after_minutes,
        rule.minimum_notice_minutes,
        rule.max_advance_days,
        rule.timezone,
        rule.effective_from ?? null,
        rule.effective_to ?? null,
        rule.is_active ? 1 : 0,
        rule.created_at,
        rule.updated_at
      );
  }

  getScheduleBlocks(provider_id: string, start_at: string, end_at: string, branch_id?: string | null): ProviderScheduleBlock[] {
    let sql = `
      SELECT * FROM provider_schedule_blocks
      WHERE provider_id = ?
        AND start_at < ?
        AND end_at > ?
    `;
    const params: any[] = [provider_id, end_at, start_at];
    if (branch_id) {
      sql += ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branch_id);
    }
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      provider_id: String(r.provider_id),
      branch_id: r.branch_id ? String(r.branch_id) : null,
      resource_id: r.resource_id ? String(r.resource_id) : null,
      start_at: String(r.start_at),
      end_at: String(r.end_at),
      reason: String(r.reason),
      created_by: String(r.created_by),
      created_at: String(r.created_at),
    }));
  }

  saveScheduleBlock(block: ProviderScheduleBlock): void {
    this.db()
      .prepare(
        `INSERT INTO provider_schedule_blocks (
          id, provider_id, branch_id, resource_id, start_at, end_at, reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        block.id,
        block.provider_id,
        block.branch_id ?? null,
        block.resource_id ?? null,
        block.start_at,
        block.end_at,
        block.reason,
        block.created_by,
        block.created_at
      );
  }

  // ==========================================
  // 3. Capacity Holds
  // ==========================================

  saveCapacityHold(hold: CapacityHold): void {
    this.db()
      .prepare(
        `INSERT INTO capacity_holds (
          id, provider_id, branch_id, slot_start_at, slot_end_at, customer_user_id, booking_id, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hold.id,
        hold.provider_id,
        hold.branch_id ?? null,
        hold.slot_start_at,
        hold.slot_end_at,
        hold.customer_user_id ?? '',
        hold.booking_id ?? null,
        hold.status,
        hold.expires_at,
        hold.created_at
      );
  }

  getCapacityHoldById(id: string): CapacityHold | null {
    const row = this.db()
      .prepare('SELECT * FROM capacity_holds WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      slot_start_at: String(row.slot_start_at),
      slot_end_at: String(row.slot_end_at),
      customer_user_id: String(row.customer_user_id),
      booking_id: row.booking_id ? String(row.booking_id) : null,
      status: row.status as any,
      expires_at: String(row.expires_at),
      created_at: String(row.created_at),
    };
  }

  updateCapacityHoldStatus(id: string, status: string, booking_id?: string): void {
    if (booking_id) {
      this.db().prepare('UPDATE capacity_holds SET status = ?, booking_id = ? WHERE id = ?').run(status, booking_id, id);
    } else {
      this.db().prepare('UPDATE capacity_holds SET status = ? WHERE id = ?').run(status, id);
    }
  }

  getActiveHoldsForSlot(provider_id: string, start_at: string, branch_id?: string | null): CapacityHold[] {
    const nowIso = new Date().toISOString();
    let sql = `
      SELECT * FROM capacity_holds
      WHERE provider_id = ?
        AND slot_start_at = ?
        AND status = 'ACTIVE'
        AND expires_at > ?
    `;
    const params: any[] = [provider_id, start_at, nowIso];
    if (branch_id) {
      sql += ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branch_id);
    }
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      provider_id: String(r.provider_id),
      branch_id: r.branch_id ? String(r.branch_id) : null,
      slot_start_at: String(r.slot_start_at),
      slot_end_at: String(r.slot_end_at),
      customer_user_id: String(r.customer_user_id),
      booking_id: r.booking_id ? String(r.booking_id) : null,
      status: r.status as any,
      expires_at: String(r.expires_at),
      created_at: String(r.created_at),
    }));
  }

  getActiveAppointmentsForWindow(provider_id: string, start_at: string, end_at: string, branch_id?: string | null): ServiceAppointment[] {
    let sql = `
      SELECT * FROM service_appointments
      WHERE provider_id = ?
        AND status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
        AND scheduled_start_at < ?
        AND scheduled_end_at > ?
    `;
    const params: any[] = [provider_id, end_at, start_at];
    if (branch_id) {
      sql += ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branch_id);
    }
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      booking_id: String(r.booking_id),
      provider_id: String(r.provider_id),
      branch_id: r.branch_id ? String(r.branch_id) : null,
      scheduled_start_at: String(r.scheduled_start_at),
      scheduled_end_at: String(r.scheduled_end_at),
      timezone: String(r.timezone || 'Africa/Nairobi'),
      status: r.status as any,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  // ==========================================
  // 4. Bookings & Items
  // ==========================================

  saveBooking(booking: Booking): void {
    this.db()
      .prepare(
        `INSERT INTO bookings (
          id, customer_user_id, vehicle_id, provider_id, branch_id, service_offering_id,
          booking_type, booking_mode, status, requested_start_at, requested_end_at,
          confirmed_start_at, confirmed_end_at, proposed_start_at, proposed_end_at,
          delivery_mode, service_address, customer_notes, source_type,
          related_maintenance_task_id, related_issue_id, service_case_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          branch_id=excluded.branch_id,
          status=excluded.status,
          requested_start_at=excluded.requested_start_at,
          requested_end_at=excluded.requested_end_at,
          confirmed_start_at=excluded.confirmed_start_at,
          confirmed_end_at=excluded.confirmed_end_at,
          proposed_start_at=excluded.proposed_start_at,
          proposed_end_at=excluded.proposed_end_at,
          customer_notes=excluded.customer_notes,
          service_case_id=excluded.service_case_id,
          updated_at=excluded.updated_at`
      )
      .run(
        booking.id,
        booking.customer_user_id ?? '',
        booking.vehicle_id,
        booking.provider_id,
        booking.branch_id ?? null,
        booking.service_offering_id ?? null,
        booking.booking_type,
        booking.booking_mode,
        booking.status,
        booking.requested_start_at ?? null,
        booking.requested_end_at ?? null,
        booking.confirmed_start_at ?? null,
        booking.confirmed_end_at ?? null,
        booking.proposed_start_at ?? null,
        booking.proposed_end_at ?? null,
        booking.delivery_mode,
        booking.service_address ?? null,
        booking.customer_notes ?? null,
        booking.source_type,
        booking.related_maintenance_task_id ?? null,
        booking.related_issue_id ?? null,
        booking.service_case_id ?? null,
        booking.created_at,
        booking.updated_at
      );
  }

  saveBookingItem(item: BookingItem): void {
    this.db()
      .prepare(
        `INSERT INTO booking_items (
          id, booking_id, service_offering_id, service_category_id, related_maintenance_task_id,
          related_issue_id, description, quantity, estimated_duration_minutes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.booking_id,
        item.service_offering_id ?? null,
        item.service_category_id,
        item.related_maintenance_task_id ?? null,
        item.related_issue_id ?? null,
        item.description,
        item.quantity,
        item.estimated_duration_minutes ?? null,
        item.status,
        item.created_at
      );
  }

  getBookingById(id: string): Booking | null {
    const row = this.db()
      .prepare('SELECT * FROM bookings WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapBooking(row);
  }

  listBookings(filters: {
    customer_user_id?: string;
    provider_id?: string;
    branch_id?: string;
    vehicle_id?: string;
    status?: BookingStatus;
  }): Booking[] {
    let sql = 'SELECT * FROM bookings WHERE 1=1';
    const params: any[] = [];

    if (filters.customer_user_id) {
      sql += ' AND customer_user_id = ?';
      params.push(filters.customer_user_id);
    }
    if (filters.provider_id) {
      sql += ' AND provider_id = ?';
      params.push(filters.provider_id);
    }
    if (filters.branch_id) {
      sql += ' AND branch_id = ?';
      params.push(filters.branch_id);
    }
    if (filters.vehicle_id) {
      sql += ' AND vehicle_id = ?';
      params.push(filters.vehicle_id);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => this.mapBooking(r));
  }

  getBookingItems(booking_id: string): BookingItem[] {
    const rows = this.db()
      .prepare('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY created_at ASC')
      .all(booking_id) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      booking_id: String(r.booking_id),
      service_offering_id: r.service_offering_id ? String(r.service_offering_id) : null,
      service_category_id: String(r.service_category_id),
      related_maintenance_task_id: r.related_maintenance_task_id ? String(r.related_maintenance_task_id) : null,
      related_issue_id: r.related_issue_id ? String(r.related_issue_id) : null,
      description: String(r.description),
      quantity: Number(r.quantity),
      estimated_duration_minutes: r.estimated_duration_minutes ? Number(r.estimated_duration_minutes) : null,
      status: String(r.status),
      created_at: String(r.created_at),
    }));
  }

  private mapBooking(row: Record<string, unknown>): Booking {
    return {
      id: String(row.id),
      customer_user_id: String(row.customer_user_id),
      vehicle_id: String(row.vehicle_id),
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      service_offering_id: row.service_offering_id ? String(row.service_offering_id) : null,
      booking_type: String(row.booking_type),
      booking_mode: row.booking_mode as any,
      status: row.status as BookingStatus,
      requested_start_at: row.requested_start_at ? String(row.requested_start_at) : null,
      requested_end_at: row.requested_end_at ? String(row.requested_end_at) : null,
      confirmed_start_at: row.confirmed_start_at ? String(row.confirmed_start_at) : null,
      confirmed_end_at: row.confirmed_end_at ? String(row.confirmed_end_at) : null,
      proposed_start_at: row.proposed_start_at ? String(row.proposed_start_at) : null,
      proposed_end_at: row.proposed_end_at ? String(row.proposed_end_at) : null,
      delivery_mode: row.delivery_mode as any,
      service_address: row.service_address ? String(row.service_address) : null,
      customer_notes: row.customer_notes ? String(row.customer_notes) : null,
      source_type: String(row.source_type),
      related_maintenance_task_id: row.related_maintenance_task_id ? String(row.related_maintenance_task_id) : null,
      related_issue_id: row.related_issue_id ? String(row.related_issue_id) : null,
      service_case_id: row.service_case_id ? String(row.service_case_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  // ==========================================
  // 5. Appointments
  // ==========================================

  saveAppointment(appointment: ServiceAppointment): void {
    this.db()
      .prepare(
        `INSERT INTO service_appointments (
          id, booking_id, provider_id, branch_id, scheduled_start_at, scheduled_end_at,
          timezone, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(booking_id) DO UPDATE SET
          scheduled_start_at=excluded.scheduled_start_at,
          scheduled_end_at=excluded.scheduled_end_at,
          status=excluded.status,
          updated_at=excluded.updated_at`
      )
      .run(
        appointment.id,
        appointment.booking_id,
        appointment.provider_id,
        appointment.branch_id ?? null,
        appointment.scheduled_start_at,
        appointment.scheduled_end_at,
        appointment.timezone,
        appointment.status,
        appointment.created_at,
        appointment.updated_at
      );
  }

  getAppointmentByBookingId(booking_id: string): ServiceAppointment | null {
    const row = this.db()
      .prepare('SELECT * FROM service_appointments WHERE booking_id = ?')
      .get(booking_id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      booking_id: String(row.booking_id),
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      scheduled_start_at: String(row.scheduled_start_at),
      scheduled_end_at: String(row.scheduled_end_at),
      timezone: String(row.timezone || 'Africa/Nairobi'),
      status: row.status as any,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  // ==========================================
  // 6. Schedule Revisions & Cancellations
  // ==========================================

  saveScheduleRevision(rev: BookingScheduleRevision): void {
    this.db()
      .prepare(
        `INSERT INTO booking_schedule_revisions (
          id, booking_id, previous_start_at, previous_end_at, new_start_at, new_end_at,
          requested_by, requested_by_role, reason, requested_at, accepted_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rev.id,
        rev.booking_id,
        rev.previous_start_at,
        rev.previous_end_at,
        rev.new_start_at,
        rev.new_end_at,
        rev.requested_by,
        rev.requested_by_role,
        rev.reason,
        rev.requested_at,
        rev.accepted_at ?? null,
        rev.status,
        rev.created_at
      );
  }

  getLatestPendingRevision(booking_id: string): BookingScheduleRevision | null {
    const row = this.db()
      .prepare('SELECT * FROM booking_schedule_revisions WHERE booking_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1')
      .get(booking_id, 'PROPOSED') as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      booking_id: String(row.booking_id),
      previous_start_at: String(row.previous_start_at),
      previous_end_at: String(row.previous_end_at),
      new_start_at: String(row.new_start_at),
      new_end_at: String(row.new_end_at),
      requested_by: String(row.requested_by),
      requested_by_role: String(row.requested_by_role),
      reason: String(row.reason),
      requested_at: String(row.requested_at),
      accepted_at: row.accepted_at ? String(row.accepted_at) : null,
      status: row.status as any,
      created_at: String(row.created_at),
    };
  }

  updateRevisionStatus(id: string, status: string, accepted_at?: string): void {
    this.db()
      .prepare('UPDATE booking_schedule_revisions SET status = ?, accepted_at = ? WHERE id = ?')
      .run(status, accepted_at ?? null, id);
  }

  listScheduleRevisions(booking_id: string): BookingScheduleRevision[] {
    const rows = this.db()
      .prepare('SELECT * FROM booking_schedule_revisions WHERE booking_id = ? ORDER BY created_at ASC')
      .all(booking_id) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      booking_id: String(row.booking_id),
      previous_start_at: String(row.previous_start_at),
      previous_end_at: String(row.previous_end_at),
      new_start_at: String(row.new_start_at),
      new_end_at: String(row.new_end_at),
      requested_by: String(row.requested_by),
      requested_by_role: String(row.requested_by_role),
      reason: String(row.reason),
      requested_at: String(row.requested_at),
      accepted_at: row.accepted_at ? String(row.accepted_at) : null,
      status: row.status as any,
      created_at: String(row.created_at),
    }));
  }

  saveCancellation(canc: BookingCancellation): void {
    this.db()
      .prepare(
        `INSERT INTO booking_cancellations (
          id, booking_id, cancelled_by, cancelled_by_role, reason_code, reason_text, cancelled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        canc.id,
        canc.booking_id,
        canc.cancelled_by,
        canc.cancelled_by_role,
        canc.reason_code,
        canc.reason_text ?? null,
        canc.cancelled_at
      );
  }

  getCancellationByBookingId(booking_id: string): BookingCancellation | null {
    const row = this.db()
      .prepare('SELECT * FROM booking_cancellations WHERE booking_id = ?')
      .get(booking_id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      booking_id: String(row.booking_id),
      cancelled_by: String(row.cancelled_by),
      cancelled_by_role: String(row.cancelled_by_role),
      reason_code: String(row.reason_code),
      reason_text: row.reason_text ? String(row.reason_text) : null,
      cancelled_at: String(row.cancelled_at),
    };
  }

  // ==========================================
  // 7. Service Estimates
  // ==========================================

  saveEstimate(est: ServiceEstimate): void {
    this.db()
      .prepare(
        `INSERT INTO service_estimates (
          id, booking_id, service_case_id, provider_id, vehicle_id, version,
          subtotal_minor, tax_estimate_minor, fees_estimate_minor, total_estimate_minor,
          currency, status, valid_until, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        est.id,
        est.booking_id ?? null,
        est.service_case_id ?? null,
        est.provider_id,
        est.vehicle_id,
        est.version,
        est.subtotal_minor,
        est.tax_estimate_minor,
        est.fees_estimate_minor,
        est.total_estimate_minor,
        est.currency,
        est.status,
        est.valid_until ?? null,
        est.notes ?? null,
        est.created_by,
        est.created_at
      );
  }

  saveEstimateLineItem(item: EstimateLineItem): void {
    this.db()
      .prepare(
        `INSERT INTO estimate_line_items (
          id, estimate_id, line_type, description, related_service_offering_id,
          related_work_recommendation_id, quantity, unit_price_minor, line_total_minor, currency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.estimate_id,
        item.line_type,
        item.description,
        item.related_service_offering_id ?? null,
        item.related_work_recommendation_id ?? null,
        item.quantity,
        item.unit_price_minor,
        item.line_total_minor,
        item.currency,
        item.created_at
      );
  }

  getEstimateById(id: string): ServiceEstimate | null {
    const row = this.db().prepare('SELECT * FROM service_estimates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const est: ServiceEstimate = {
      id: String(row.id),
      booking_id: row.booking_id ? String(row.booking_id) : null,
      service_case_id: row.service_case_id ? String(row.service_case_id) : null,
      provider_id: String(row.provider_id),
      vehicle_id: String(row.vehicle_id),
      version: Number(row.version),
      subtotal_minor: Number(row.subtotal_minor),
      tax_estimate_minor: Number(row.tax_estimate_minor),
      fees_estimate_minor: Number(row.fees_estimate_minor),
      total_estimate_minor: Number(row.total_estimate_minor),
      currency: String(row.currency || 'KES'),
      status: row.status as any,
      valid_until: row.valid_until ? String(row.valid_until) : null,
      notes: row.notes ? String(row.notes) : null,
      created_by: String(row.created_by),
      created_at: String(row.created_at),
    };
    est.line_items = this.getEstimateLineItems(est.id);
    return est;
  }

  getEstimateLineItems(estimate_id: string): EstimateLineItem[] {
    const rows = this.db()
      .prepare('SELECT * FROM estimate_line_items WHERE estimate_id = ? ORDER BY created_at ASC')
      .all(estimate_id) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      estimate_id: String(r.estimate_id),
      line_type: r.line_type as any,
      description: String(r.description),
      related_service_offering_id: r.related_service_offering_id ? String(r.related_service_offering_id) : null,
      related_work_recommendation_id: r.related_work_recommendation_id ? String(r.related_work_recommendation_id) : null,
      quantity: Number(r.quantity),
      unit_price_minor: Number(r.unit_price_minor),
      line_total_minor: Number(r.line_total_minor),
      currency: String(r.currency || 'KES'),
      created_at: String(r.created_at),
    }));
  }

  listEstimatesForBooking(booking_id: string): ServiceEstimate[] {
    const rows = this.db()
      .prepare('SELECT id FROM service_estimates WHERE booking_id = ? ORDER BY version DESC')
      .all(booking_id) as Record<string, unknown>[];
    return rows.map((r) => this.getEstimateById(String(r.id))!).filter(Boolean);
  }

  // ==========================================
  // 8. Service Quotes & Line Items
  // ==========================================

  saveQuote(quote: ServiceQuote): void {
    this.db()
      .prepare(
        `INSERT INTO service_quotes (
          id, booking_id, service_case_id, provider_id, branch_id, vehicle_id, customer_user_id,
          quote_number, version, status, quote_type, currency, subtotal_minor, tax_minor, tax_rate,
          fees_minor, discounts_minor, total_minor, valid_until, terms_and_conditions,
          supersedes_quote_id, service_authorization_id, created_by, created_at, issued_at,
          viewed_at, accepted_at, rejected_at, withdrawal_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,
          subtotal_minor=excluded.subtotal_minor,
          tax_minor=excluded.tax_minor,
          total_minor=excluded.total_minor,
          issued_at=excluded.issued_at,
          viewed_at=excluded.viewed_at,
          accepted_at=excluded.accepted_at,
          rejected_at=excluded.rejected_at,
          withdrawal_reason=excluded.withdrawal_reason,
          service_authorization_id=excluded.service_authorization_id,
          valid_until=excluded.valid_until,
          terms_and_conditions=excluded.terms_and_conditions`
      )
      .run(
        quote.id,
        quote.booking_id ?? null,
        quote.service_case_id ?? null,
        quote.provider_id,
        quote.branch_id ?? null,
        quote.vehicle_id,
        quote.customer_user_id,
        quote.quote_number,
        quote.version,
        quote.status,
        quote.quote_type,
        quote.currency,
        quote.subtotal_minor,
        quote.tax_minor,
        quote.tax_rate,
        quote.fees_minor,
        quote.discounts_minor,
        quote.total_minor,
        quote.valid_until,
        quote.terms_and_conditions ?? null,
        quote.supersedes_quote_id ?? null,
        quote.service_authorization_id ?? null,
        quote.created_by,
        quote.created_at,
        quote.issued_at ?? null,
        quote.viewed_at ?? null,
        quote.accepted_at ?? null,
        quote.rejected_at ?? null,
        quote.withdrawal_reason ?? null
      );
  }

  saveQuoteLineItem(item: QuoteLineItem): void {
    this.db()
      .prepare(
        `INSERT INTO quote_line_items (
          id, quote_id, line_type, service_category, description, quantity, unit_price_minor, line_total_minor,
          related_recommended_work_item_id, related_service_offering_id, related_part_reference_id,
          authorization_required, is_optional, dependency_group_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status`
      )
      .run(
        item.id,
        item.quote_id,
        item.line_type,
        item.service_category ?? null,
        item.description,
        item.quantity,
        item.unit_price_minor,
        item.line_total_minor,
        item.related_recommended_work_item_id ?? null,
        item.related_service_offering_id ?? null,
        item.related_part_reference_id ?? null,
        item.authorization_required ? 1 : 0,
        item.is_optional ? 1 : 0,
        item.dependency_group_id ?? null,
        item.status,
        item.created_at
      );
  }

  getQuoteById(id: string): ServiceQuote | null {
    const row = this.db().prepare('SELECT * FROM service_quotes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateQuote(row);
  }

  listQuotes(filters: {
    booking_id?: string;
    service_case_id?: string;
    provider_id?: string;
    customer_user_id?: string;
    status?: QuoteStatus;
  }): ServiceQuote[] {
    let sql = 'SELECT * FROM service_quotes WHERE 1=1';
    const params: any[] = [];

    if (filters.booking_id) {
      sql += ' AND booking_id = ?';
      params.push(filters.booking_id);
    }
    if (filters.service_case_id) {
      sql += ' AND service_case_id = ?';
      params.push(filters.service_case_id);
    }
    if (filters.provider_id) {
      sql += ' AND provider_id = ?';
      params.push(filters.provider_id);
    }
    if (filters.customer_user_id) {
      sql += ' AND customer_user_id = ?';
      params.push(filters.customer_user_id);
    }
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';
    const rows = this.db().prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateQuote(r));
  }

  private hydrateQuote(row: Record<string, unknown>): ServiceQuote {
    const quoteId = String(row.id);
    const quote: ServiceQuote = {
      id: quoteId,
      booking_id: row.booking_id ? String(row.booking_id) : null,
      service_case_id: row.service_case_id ? String(row.service_case_id) : null,
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      vehicle_id: String(row.vehicle_id),
      customer_user_id: String(row.customer_user_id),
      quote_number: String(row.quote_number),
      version: Number(row.version),
      status: row.status as QuoteStatus,
      quote_type: row.quote_type as any,
      currency: String(row.currency || 'KES'),
      subtotal_minor: Number(row.subtotal_minor),
      tax_minor: Number(row.tax_minor),
      tax_rate: Number(row.tax_rate),
      fees_minor: Number(row.fees_minor),
      discounts_minor: Number(row.discounts_minor),
      total_minor: Number(row.total_minor),
      valid_until: String(row.valid_until),
      terms_and_conditions: row.terms_and_conditions ? String(row.terms_and_conditions) : null,
      supersedes_quote_id: row.supersedes_quote_id ? String(row.supersedes_quote_id) : null,
      service_authorization_id: row.service_authorization_id ? String(row.service_authorization_id) : null,
      created_by: String(row.created_by),
      created_at: String(row.created_at),
      issued_at: row.issued_at ? String(row.issued_at) : null,
      viewed_at: row.viewed_at ? String(row.viewed_at) : null,
      accepted_at: row.accepted_at ? String(row.accepted_at) : null,
      rejected_at: row.rejected_at ? String(row.rejected_at) : null,
      withdrawal_reason: row.withdrawal_reason ? String(row.withdrawal_reason) : null,
    };

    quote.line_items = this.getQuoteLineItems(quoteId);
    quote.acceptance = this.getQuoteAcceptance(quoteId);
    quote.rejection = this.getQuoteRejection(quoteId);
    return quote;
  }

  getQuoteLineItems(quote_id: string): QuoteLineItem[] {
    const rows = this.db()
      .prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY created_at ASC')
      .all(quote_id) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      quote_id: String(r.quote_id),
      line_type: r.line_type as any,
      service_category: r.service_category ? String(r.service_category) : null,
      description: String(r.description),
      quantity: Number(r.quantity),
      unit_price_minor: Number(r.unit_price_minor),
      line_total_minor: Number(r.line_total_minor),
      related_recommended_work_item_id: r.related_recommended_work_item_id ? String(r.related_recommended_work_item_id) : null,
      related_service_offering_id: r.related_service_offering_id ? String(r.related_service_offering_id) : null,
      related_part_reference_id: r.related_part_reference_id ? String(r.related_part_reference_id) : null,
      authorization_required: Boolean(r.authorization_required),
      is_optional: Boolean(r.is_optional),
      dependency_group_id: r.dependency_group_id ? String(r.dependency_group_id) : null,
      status: r.status as any,
      created_at: String(r.created_at),
    }));
  }

  // ==========================================
  // 9. Quote Acceptances & Rejections
  // ==========================================

  saveQuoteAcceptance(acc: QuoteAcceptance): void {
    this.db()
      .prepare(
        `INSERT INTO quote_acceptances (
          id, quote_id, quote_version, accepted_by_user_id, accepted_by_name, authorization_channel,
          is_partial, amount_authorized_minor, currency, terms_version, accepted_at,
          service_authorization_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        acc.id,
        acc.quote_id,
        acc.quote_version,
        acc.accepted_by_user_id,
        acc.accepted_by_name,
        acc.authorization_channel,
        acc.is_partial ? 1 : 0,
        acc.amount_authorized_minor,
        acc.currency,
        acc.terms_version,
        acc.accepted_at,
        acc.service_authorization_id ?? null,
        acc.metadata_json ?? null
      );
  }

  saveQuoteAcceptanceItem(item: QuoteAcceptanceItem): void {
    this.db()
      .prepare(
        `INSERT INTO quote_acceptance_items (
          id, quote_acceptance_id, quote_line_item_id, line_total_minor, created_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(item.id, item.quote_acceptance_id, item.quote_line_item_id, item.line_total_minor, item.created_at);
  }

  getQuoteAcceptance(quote_id: string): QuoteAcceptance | null {
    const row = this.db()
      .prepare('SELECT * FROM quote_acceptances WHERE quote_id = ? ORDER BY accepted_at DESC LIMIT 1')
      .get(quote_id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const accId = String(row.id);
    const itemRows = this.db()
      .prepare('SELECT * FROM quote_acceptance_items WHERE quote_acceptance_id = ?')
      .all(accId) as Record<string, unknown>[];

    return {
      id: accId,
      quote_id: String(row.quote_id),
      quote_version: Number(row.quote_version),
      accepted_by_user_id: String(row.accepted_by_user_id),
      accepted_by_name: String(row.accepted_by_name),
      authorization_channel: String(row.authorization_channel),
      is_partial: Boolean(row.is_partial),
      amount_authorized_minor: Number(row.amount_authorized_minor),
      currency: String(row.currency || 'KES'),
      terms_version: String(row.terms_version || '1.0'),
      accepted_at: String(row.accepted_at),
      service_authorization_id: row.service_authorization_id ? String(row.service_authorization_id) : null,
      metadata_json: row.metadata_json ? String(row.metadata_json) : null,
      accepted_items: itemRows.map((it) => ({
        id: String(it.id),
        quote_acceptance_id: String(it.quote_acceptance_id),
        quote_line_item_id: String(it.quote_line_item_id),
        line_total_minor: Number(it.line_total_minor),
        created_at: String(it.created_at),
      })),
    };
  }

  saveQuoteRejection(rej: QuoteRejection): void {
    this.db()
      .prepare(
        `INSERT INTO quote_rejections (
          id, quote_id, quote_version, rejected_by_user_id, rejected_by_name,
          reason_code, reason_text, rejected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rej.id,
        rej.quote_id,
        rej.quote_version,
        rej.rejected_by_user_id,
        rej.rejected_by_name,
        rej.reason_code,
        rej.reason_text ?? null,
        rej.rejected_at
      );
  }

  getQuoteRejection(quote_id: string): QuoteRejection | null {
    const row = this.db()
      .prepare('SELECT * FROM quote_rejections WHERE quote_id = ? ORDER BY rejected_at DESC LIMIT 1')
      .get(quote_id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      quote_id: String(row.quote_id),
      quote_version: Number(row.quote_version),
      rejected_by_user_id: String(row.rejected_by_user_id),
      rejected_by_name: String(row.rejected_by_name),
      reason_code: String(row.reason_code),
      reason_text: row.reason_text ? String(row.reason_text) : null,
      rejected_at: String(row.rejected_at),
    };
  }

  // ==========================================
  // 10. Booking Activity
  // ==========================================

  recordActivity(activity: BookingActivity): void {
    this.db()
      .prepare(
        `INSERT INTO booking_activity (id, booking_id, action, actor_id, actor_name, details, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        activity.id,
        activity.booking_id,
        activity.action,
        activity.actor_id || 'usr_system',
        activity.actor_name ?? null,
        activity.details ?? null,
        activity.occurred_at
      );
  }

  getBookingActivity(booking_id: string): BookingActivity[] {
    const rows = this.db()
      .prepare('SELECT * FROM booking_activity WHERE booking_id = ? ORDER BY occurred_at ASC')
      .all(booking_id) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      booking_id: String(r.booking_id),
      action: String(r.action),
      actor_id: String(r.actor_id),
      actor_name: r.actor_name ? String(r.actor_name) : null,
      details: r.details ? String(r.details) : null,
      occurred_at: String(r.occurred_at),
    }));
  }

  // ==========================================
  // 11. Batch Jobs & Background Maintenance
  // ==========================================

  expireActiveCapacityHoldsBefore(cutoffIso: string): number {
    const res = this.db()
      .prepare("UPDATE capacity_holds SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= ?")
      .run(cutoffIso);
    return Number(res.changes);
  }

  getIssuedQuotesExpiringBefore(cutoffIso: string): ServiceQuote[] {
    const rows = this.db()
      .prepare("SELECT * FROM service_quotes WHERE status = 'ISSUED' AND valid_until <= ?")
      .all(cutoffIso) as Record<string, unknown>[];
    return rows.map((r) => this.hydrateQuote(r));
  }

  getStaleBookingRequestsBefore(cutoffIso: string): Booking[] {
    const rows = this.db()
      .prepare("SELECT * FROM bookings WHERE status IN ('REQUESTED', 'PENDING_PROVIDER') AND created_at <= ?")
      .all(cutoffIso) as Record<string, unknown>[];
    return rows.map((r) => this.mapBooking(r));
  }

  getAppointmentsInRange(startIso: string, endIso: string): ServiceAppointment[] {
    const rows = this.db()
      .prepare(
        "SELECT * FROM service_appointments WHERE status = 'SCHEDULED' AND scheduled_start_at >= ? AND scheduled_start_at <= ?"
      )
      .all(startIso, endIso) as Record<string, unknown>[];
    return rows.map((r) => this.mapServiceAppointment(r));
  }

  private mapServiceAppointment(row: Record<string, unknown>): ServiceAppointment {
    return {
      id: String(row.id),
      booking_id: String(row.booking_id),
      provider_id: String(row.provider_id),
      branch_id: row.branch_id ? String(row.branch_id) : null,
      scheduled_start_at: String(row.scheduled_start_at),
      scheduled_end_at: String(row.scheduled_end_at),
      timezone: String(row.timezone || 'Africa/Nairobi'),
      status: row.status as any,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
}

export const bookingRepository = new BookingRepository();
