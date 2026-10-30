/**
 * GAR-013: Booking, Scheduling, Quotes & Service Transaction Architecture
 * Domain Service Layer
 */

import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString, normalizeToUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { eventBus } from '../events/eventBus';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { BookingRepository } from './bookingRepository';
import {
  ServiceOffering,
  ProviderCapacityRule,
  ProviderScheduleBlock,
  CapacityHold,
  AvailableSlot,
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
  QuoteRejection,
  BookingStatus,
  QuoteStatus,
  QuoteType,
  DeliveryMode,
  BookingMode,
  PricingModel,
  LineItemType,
} from './types';
import { garageOperationsService } from '../operations/garageOperationsService';
import { operationsRepository } from '../operations/operationsRepository';
import {
  ServiceAuthorizationType,
  AuthorizationChannel,
  ServiceCaseSourceType,
  RecommendedWorkPriority,
  RecommendedWorkStatus,
} from '../operations/types';

export interface BookingActorContext {
  actor_id?: string;
  user_id?: string;
  id?: string;
  actor_type?: string;
  name?: string;
  roles?: string[];
  [key: string]: any;
}

export function getActorId(actor?: BookingActorContext | any): string {
  return actor?.actor_id || actor?.user_id || actor?.id || 'usr_system';
}

export function getActorName(actor?: BookingActorContext | any): string {
  return actor?.name || actor?.profile?.display_name || actor?.display_name || 'System User';
}

export class BookingService {
  private repo: BookingRepository;

  constructor(repo?: BookingRepository) {
    this.repo = repo || new BookingRepository();
  }

  // =========================================================================
  // 1. Service Offerings
  // =========================================================================

  listOfferings(filters: {
    provider_id?: string;
    branch_id?: string;
    service_category_id?: string;
    status?: string;
  }): ServiceOffering[] {
    return this.repo.listServiceOfferings(filters);
  }

  getOffering(id: string): ServiceOffering {
    const offering = this.repo.getServiceOfferingById(id);
    if (!offering) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Service offering '${id}' not found`, 404);
    }
    return offering;
  }

  createOffering(
    actor: BookingActorContext,
    dto: {
      provider_id: string;
      branch_id?: string | null;
      service_category_id: string;
      capability_id?: string | null;
      name: string;
      description?: string | null;
      delivery_mode?: DeliveryMode;
      booking_mode?: BookingMode;
      estimated_duration_minutes?: number | null;
      pricing_model?: PricingModel;
      base_price_minor?: number | null;
      currency?: string;
      requires_inspection?: boolean;
      requires_quote?: boolean;
      requires_vehicle?: boolean;
    }
  ): ServiceOffering {
    const now = getCurrentUtcIsoString();
    const offering: ServiceOffering = {
      id: generateCanonicalId('off'),
      provider_id: dto.provider_id,
      branch_id: dto.branch_id ?? null,
      service_category_id: dto.service_category_id,
      capability_id: dto.capability_id ?? null,
      name: dto.name,
      description: dto.description ?? null,
      delivery_mode: dto.delivery_mode || 'WORKSHOP',
      booking_mode: dto.booking_mode || 'PROVIDER_CONFIRMATION',
      estimated_duration_minutes: dto.estimated_duration_minutes ?? 60,
      pricing_model: dto.pricing_model || 'STARTING_FROM',
      base_price_minor: dto.base_price_minor ?? null,
      currency: dto.currency || 'KES',
      requires_inspection: Boolean(dto.requires_inspection),
      requires_quote: Boolean(dto.requires_quote),
      requires_vehicle: dto.requires_vehicle !== undefined ? dto.requires_vehicle : true,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    this.repo.saveServiceOffering(offering);
    return offering;
  }

  // =========================================================================
  // 2. Capacity & Availability Engine
  // =========================================================================

  getAvailableSlots(params: {
    provider_id: string;
    branch_id?: string | null;
    from_date: string; // YYYY-MM-DD
    to_date: string; // YYYY-MM-DD
    duration_minutes?: number;
  }): AvailableSlot[] {
    const rules = this.repo.getCapacityRules(params.provider_id, params.branch_id);
    if (rules.length === 0) {
      return [];
    }

    const from = new Date(params.from_date + 'T00:00:00Z');
    const to = new Date(params.to_date + 'T23:59:59Z');
    const now = new Date();

    const slots: AvailableSlot[] = [];

    // Iterate day by day
    for (let cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
      const dayOfWeek = cur.getUTCDay(); // 0-6
      const matchingRules = rules.filter((r) => r.day_of_week === dayOfWeek);

      for (const rule of matchingRules) {
        const [startH, startM] = rule.start_time.split(':').map(Number);
        const [endH, endM] = rule.end_time.split(':').map(Number);

        const dayDateStr = cur.toISOString().split('T')[0];
        const dayStart = new Date(`${dayDateStr}T${rule.start_time}:00Z`);
        const dayEnd = new Date(`${dayDateStr}T${rule.end_time}:00Z`);

        const slotDur = rule.slot_duration_minutes || 60;
        const totalCap = rule.max_concurrent_bookings || 2;

        for (
          let slotStart = new Date(dayStart);
          slotStart.getTime() + slotDur * 60000 <= dayEnd.getTime();
          slotStart = new Date(slotStart.getTime() + slotDur * 60000)
        ) {
          const slotEnd = new Date(slotStart.getTime() + slotDur * 60000);

          const curDateStr = cur.toISOString().split('T')[0];
          const nowDateStr = now.toISOString().split('T')[0];

          if (curDateStr >= nowDateStr) {
            // Notice window check: minimum_notice_minutes
            const noticeTime = new Date(now.getTime() + (rule.minimum_notice_minutes || 120) * 60000);
            if (slotStart < noticeTime) {
              continue;
            }

            // Advance window check: max_advance_days
            const maxAdvanceTime = new Date(now.getTime() + (rule.max_advance_days || 30) * 86400000);
            if (slotStart > maxAdvanceTime) {
              continue;
            }
          }

          const slotStartIso = slotStart.toISOString();
          const slotEndIso = slotEnd.toISOString();

          // Check schedule blocks
          const blocks = this.repo.getScheduleBlocks(params.provider_id, slotStartIso, slotEndIso, params.branch_id);
          if (blocks.length > 0) {
            continue; // blocked
          }

          // Count active appointments
          const appts = this.repo.getActiveAppointmentsForWindow(params.provider_id, slotStartIso, slotEndIso, params.branch_id);
          // Count active holds
          const holds = this.repo.getActiveHoldsForSlot(params.provider_id, slotStartIso, params.branch_id);

          const booked = appts.length + holds.length;
          const available = Math.max(0, totalCap - booked);

          slots.push({
            start_at: slotStartIso,
            end_at: slotEndIso,
            slot_start_at: slotStartIso,
            slot_end_at: slotEndIso,
            capacity_total: totalCap,
            capacity_available: available,
            capacity_remaining: available,
            is_available: available > 0,
            available: available > 0,
          });
        }
      }
    }

    return slots;
  }

  getAvailability(
    provider_id: string,
    params: {
      branch_id?: string | null;
      service_offering_id?: string | null;
      date_from: string;
      date_to: string;
      duration_minutes?: number;
    }
  ): AvailableSlot[] {
    return this.getAvailableSlots({
      provider_id,
      branch_id: params.branch_id,
      from_date: params.date_from,
      to_date: params.date_to,
      duration_minutes: params.duration_minutes,
    });
  }

  setCapacityRule(
    actor: BookingActorContext,
    dto: {
      provider_id: string;
      branch_id?: string | null;
      service_category_id?: string | null;
      day_of_week: number;
      start_time: string;
      end_time: string;
      max_concurrent_bookings?: number;
      slot_duration_minutes?: number;
      buffer_before_minutes?: number;
      buffer_after_minutes?: number;
      minimum_notice_minutes?: number;
      max_advance_days?: number;
      timezone?: string;
    }
  ): ProviderCapacityRule {
    const now = getCurrentUtcIsoString();
    const rule: ProviderCapacityRule = {
      id: generateCanonicalId('cap'),
      provider_id: dto.provider_id,
      branch_id: dto.branch_id ?? null,
      service_category_id: dto.service_category_id ?? null,
      day_of_week: dto.day_of_week,
      start_time: dto.start_time,
      end_time: dto.end_time,
      max_concurrent_bookings: dto.max_concurrent_bookings ?? 2,
      slot_duration_minutes: dto.slot_duration_minutes ?? 60,
      buffer_before_minutes: dto.buffer_before_minutes ?? 0,
      buffer_after_minutes: dto.buffer_after_minutes ?? 15,
      minimum_notice_minutes: dto.minimum_notice_minutes ?? 120,
      max_advance_days: dto.max_advance_days ?? 30,
      timezone: dto.timezone ?? 'Africa/Nairobi',
      effective_from: null,
      effective_to: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    this.repo.saveCapacityRule(rule);
    return rule;
  }

  getCapacityRules(provider_id: string, branch_id?: string | null): ProviderCapacityRule[] {
    return this.repo.getCapacityRules(provider_id, branch_id);
  }

  createCapacityHold(
    actor: BookingActorContext,
    dto: {
      provider_id: string;
      branch_id?: string | null;
      slot_start_at: string;
      slot_end_at: string;
      ttl_minutes?: number;
    }
  ): CapacityHold {
    const slotStartIso = normalizeToUtcIsoString(dto.slot_start_at);
    const slotEndIso = normalizeToUtcIsoString(dto.slot_end_at);

    // Verify slot is available
    const rules = this.repo.getCapacityRules(dto.provider_id, dto.branch_id);
    const totalCap = rules[0]?.max_concurrent_bookings || 2;

    const appts = this.repo.getActiveAppointmentsForWindow(dto.provider_id, slotStartIso, slotEndIso, dto.branch_id);
    const holds = this.repo.getActiveHoldsForSlot(dto.provider_id, slotStartIso, dto.branch_id);

    if (appts.length + holds.length >= totalCap) {
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION, 'Selected appointment slot is no longer available', 409);
    }

    const now = getCurrentUtcIsoString();
    const ttlMinutes = dto.ttl_minutes || 15;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();

    const hold: CapacityHold = {
      id: generateCanonicalId('hld'),
      provider_id: dto.provider_id,
      branch_id: dto.branch_id ?? null,
      slot_start_at: slotStartIso,
      slot_end_at: slotEndIso,
      customer_user_id: getActorId(actor),
      status: 'ACTIVE',
      expires_at: expiresAt,
      created_at: now,
    };

    this.repo.saveCapacityHold(hold);

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.hold_placed',
        correlation_id: hold.id,
        subject_ids: { provider: hold.provider_id, hold: hold.id },
        actor_id: getActorId(actor),
        payload: { hold_id: hold.id, slot_start_at: hold.slot_start_at, expires_at: hold.expires_at },
      })
    );

    return hold;
  }

  // =========================================================================
  // 3. Booking Lifecycle
  // =========================================================================

  createBooking(
    actor: BookingActorContext,
    dto: {
      customer_user_id?: string;
      vehicle_id: string;
      provider_id: string;
      branch_id?: string | null;
      service_offering_id?: string | null;
      items?: Array<{
        service_offering_id?: string | null;
        service_category_id: string;
        description: string;
        quantity?: number;
        related_maintenance_task_id?: string | null;
        related_issue_id?: string | null;
      }>;
      hold_id?: string | null;
      requested_start_at?: string | null;
      requested_end_at?: string | null;
      delivery_mode?: DeliveryMode;
      service_address?: string | null;
      customer_notes?: string | null;
      related_maintenance_task_id?: string | null;
      related_issue_id?: string | null;
    }
  ): Booking {
    const customerUserId = dto.customer_user_id || getActorId(actor);
    const now = getCurrentUtcIsoString();

    let offering: ServiceOffering | null = null;
    if (dto.service_offering_id) {
      offering = this.repo.getServiceOfferingById(dto.service_offering_id);
    }

    let startAt = dto.requested_start_at ? normalizeToUtcIsoString(dto.requested_start_at) : null;
    let endAt = dto.requested_end_at ? normalizeToUtcIsoString(dto.requested_end_at) : null;

    // If hold_id is provided, consume the hold
    if (dto.hold_id) {
      const hold = this.repo.getCapacityHoldById(dto.hold_id);
      if (!hold || hold.status !== 'ACTIVE' || new Date(hold.expires_at) < new Date()) {
        throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION, 'Slot reservation has expired or is invalid', 400);
      }
      startAt = hold.slot_start_at;
      endAt = hold.slot_end_at;
    }

    // Default 60 min window if start is given without end
    if (startAt && !endAt) {
      const dur = offering?.estimated_duration_minutes || 60;
      endAt = new Date(new Date(startAt).getTime() + dur * 60000).toISOString();
    }

    const bookingMode = offering?.booking_mode || 'PROVIDER_CONFIRMATION';
    const isInstant = bookingMode === 'INSTANT_CONFIRMATION' && Boolean(startAt);

    const bookingId = generateCanonicalId('bkg');
    const initialStatus: BookingStatus = isInstant ? 'CONFIRMED' : 'REQUESTED';

    const booking: Booking = {
      id: bookingId,
      customer_user_id: customerUserId,
      vehicle_id: dto.vehicle_id,
      provider_id: dto.provider_id,
      branch_id: dto.branch_id ?? offering?.branch_id ?? null,
      service_offering_id: dto.service_offering_id ?? null,
      booking_type: offering ? 'SERVICE_OFFERING' : 'CUSTOM_REQUEST',
      booking_mode: bookingMode,
      status: initialStatus,
      requested_start_at: startAt,
      requested_end_at: endAt,
      confirmed_start_at: isInstant ? startAt : null,
      confirmed_end_at: isInstant ? endAt : null,
      delivery_mode: dto.delivery_mode || offering?.delivery_mode || 'WORKSHOP',
      service_address: dto.service_address ?? null,
      customer_notes: dto.customer_notes ?? null,
      source_type: 'DIRECT_CUSTOMER',
      related_maintenance_task_id: dto.related_maintenance_task_id ?? null,
      related_issue_id: dto.related_issue_id ?? null,
      service_case_id: null,
      created_at: now,
      updated_at: now,
    };

    this.repo.saveBooking(booking);

    // Save items
    const rawItems = dto.items && dto.items.length > 0
      ? dto.items
      : [
          {
            service_offering_id: offering?.id ?? null,
            service_category_id: offering?.service_category_id ?? 'CAT_GENERAL',
            description: offering?.name ?? 'Vehicle Inspection & Service',
            quantity: 1,
            related_maintenance_task_id: dto.related_maintenance_task_id ?? null,
            related_issue_id: dto.related_issue_id ?? null,
          },
        ];

    for (const it of rawItems) {
      this.repo.saveBookingItem({
        id: generateCanonicalId('bki'),
        booking_id: bookingId,
        service_offering_id: it.service_offering_id ?? null,
        service_category_id: it.service_category_id,
        related_maintenance_task_id: it.related_maintenance_task_id ?? null,
        related_issue_id: it.related_issue_id ?? null,
        description: it.description,
        quantity: it.quantity || 1,
        estimated_duration_minutes: offering?.estimated_duration_minutes ?? 60,
        status: 'REQUESTED',
        created_at: now,
      });
    }

    // If hold was used, mark hold consumed
    if (dto.hold_id) {
      this.repo.updateCapacityHoldStatus(dto.hold_id, 'CONSUMED', bookingId);
    }

    // If instant confirmation, create ServiceAppointment
    if (isInstant && startAt && endAt) {
      const appt: ServiceAppointment = {
        id: generateCanonicalId('apt'),
        booking_id: bookingId,
        provider_id: booking.provider_id,
        branch_id: booking.branch_id,
        scheduled_start_at: startAt,
        scheduled_end_at: endAt,
        timezone: 'Africa/Nairobi',
        status: 'SCHEDULED',
        created_at: now,
        updated_at: now,
      };
      this.repo.saveAppointment(appt);

      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'booking.confirmed',
          correlation_id: bookingId,
          subject_ids: { booking: bookingId, vehicle: booking.vehicle_id, provider: booking.provider_id },
          actor_id: getActorId(actor),
          payload: { booking_id: bookingId, scheduled_start_at: startAt, scheduled_end_at: endAt, instant: true },
        })
      );
    } else {
      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'booking.requested',
          correlation_id: bookingId,
          subject_ids: { booking: bookingId, vehicle: booking.vehicle_id, provider: booking.provider_id },
          actor_id: getActorId(actor),
          payload: { booking_id: bookingId, requested_start_at: startAt, requested_end_at: endAt },
        })
      );
    }

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: bookingId,
      action: isInstant ? 'BOOKING_INSTANTLY_CONFIRMED' : 'BOOKING_REQUESTED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Booking created with status ${initialStatus}`,
      occurred_at: now,
    });

    return this.getBooking(bookingId);
  }

  getBooking(id: string): Booking {
    const booking = this.repo.getBookingById(id);
    if (!booking) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Booking '${id}' not found`, 404);
    }

    booking.items = this.repo.getBookingItems(id);
    booking.appointment = this.repo.getAppointmentByBookingId(id);
    booking.quotes = this.repo.listQuotes({ booking_id: id });
    booking.estimates = this.repo.listEstimatesForBooking(id);
    booking.active_revision = this.repo.getLatestPendingRevision(id);
    booking.cancellation = this.repo.getCancellationByBookingId(id);

    return booking;
  }

  listBookings(filters: {
    customer_user_id?: string;
    provider_id?: string;
    branch_id?: string;
    vehicle_id?: string;
    status?: BookingStatus;
  }): Booking[] {
    const bookings = this.repo.listBookings(filters);
    return bookings.map((b) => this.getBooking(b.id));
  }

  confirmBooking(
    actor: BookingActorContext,
    booking_id: string,
    dto?: { confirmed_start_at?: string; confirmed_end_at?: string }
  ): Booking {
    const booking = this.getBooking(booking_id);

    if (booking.status !== 'REQUESTED' && booking.status !== 'DRAFT') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot confirm booking with status '${booking.status}'`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const startAt = dto?.confirmed_start_at ? normalizeToUtcIsoString(dto.confirmed_start_at) : booking.requested_start_at;
    const endAt = dto?.confirmed_end_at ? normalizeToUtcIsoString(dto.confirmed_end_at) : booking.requested_end_at;

    if (!startAt || !endAt) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Confirmed appointment start and end times are required', 400);
    }

    booking.status = 'CONFIRMED';
    booking.confirmed_start_at = startAt;
    booking.confirmed_end_at = endAt;
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    // Save Appointment
    const appt: ServiceAppointment = {
      id: generateCanonicalId('apt'),
      booking_id: booking.id,
      provider_id: booking.provider_id,
      branch_id: booking.branch_id,
      scheduled_start_at: startAt,
      scheduled_end_at: endAt,
      timezone: 'Africa/Nairobi',
      status: 'SCHEDULED',
      created_at: now,
      updated_at: now,
    };
    this.repo.saveAppointment(appt);

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'BOOKING_CONFIRMED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Booking confirmed for ${startAt} to ${endAt}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.confirmed',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id, confirmed_start_at: startAt, confirmed_end_at: endAt },
      })
    );

    return this.getBooking(booking.id);
  }

  acceptBooking(
    actor: BookingActorContext,
    booking_id: string,
    dto?: { confirmed_start_at?: string; confirmed_end_at?: string }
  ): Booking {
    return this.confirmBooking(actor, booking_id, dto);
  }

  getAppointmentForBooking(booking_id: string): ServiceAppointment | null {
    return this.repo.getAppointmentByBookingId(booking_id);
  }

  proposeReschedule(
    actor: BookingActorContext,
    booking_id: string,
    dto: {
      new_start_at: string;
      new_end_at: string;
      reason: string;
    }
  ): BookingScheduleRevision {
    const booking = this.getBooking(booking_id);

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.status === 'CHECKED_IN') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot reschedule booking with status '${booking.status}'`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const newStart = normalizeToUtcIsoString(dto.new_start_at);
    const newEnd = normalizeToUtcIsoString(dto.new_end_at);

    const prevStart = booking.confirmed_start_at || booking.requested_start_at || now;
    const prevEnd = booking.confirmed_end_at || booking.requested_end_at || now;

    const revision: BookingScheduleRevision = {
      id: generateCanonicalId('bsr'),
      booking_id: booking.id,
      previous_start_at: prevStart,
      previous_end_at: prevEnd,
      new_start_at: newStart,
      new_end_at: newEnd,
      requested_by: getActorId(actor),
      requested_by_role: actor.roles?.includes('OWNER') || actor.roles?.includes('ADMIN') || actor.roles?.includes('SERVICE_ADVISOR')
        ? 'PROVIDER'
        : 'CUSTOMER',
      reason: dto.reason,
      requested_at: now,
      status: 'PROPOSED',
      created_at: now,
    };

    this.repo.saveScheduleRevision(revision);

    booking.proposed_start_at = newStart;
    booking.proposed_end_at = newEnd;
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'RESCHEDULE_PROPOSED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Proposed new time: ${newStart} - Reason: ${dto.reason}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.reschedule_requested',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id, revision_id: revision.id, new_start_at: newStart, new_end_at: newEnd },
      })
    );

    return revision;
  }

  acceptReschedule(actor: BookingActorContext, booking_id: string, revision_id: string): Booking {
    const booking = this.getBooking(booking_id);
    const revision = this.repo.getLatestPendingRevision(booking_id);

    if (!revision || revision.id !== revision_id || revision.status !== 'PROPOSED') {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Pending schedule revision not found', 404);
    }

    const now = getCurrentUtcIsoString();
    this.repo.updateRevisionStatus(revision.id, 'ACCEPTED', now);

    booking.status = 'CONFIRMED';
    booking.confirmed_start_at = revision.new_start_at;
    booking.confirmed_end_at = revision.new_end_at;
    booking.proposed_start_at = null;
    booking.proposed_end_at = null;
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    // Update appointment
    const appt: ServiceAppointment = {
      id: generateCanonicalId('apt'),
      booking_id: booking.id,
      provider_id: booking.provider_id,
      branch_id: booking.branch_id,
      scheduled_start_at: revision.new_start_at,
      scheduled_end_at: revision.new_end_at,
      timezone: 'Africa/Nairobi',
      status: 'SCHEDULED',
      created_at: now,
      updated_at: now,
    };
    this.repo.saveAppointment(appt);

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'RESCHEDULE_ACCEPTED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Accepted new schedule: ${revision.new_start_at} to ${revision.new_end_at}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.reschedule_accepted',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id, scheduled_start_at: revision.new_start_at, scheduled_end_at: revision.new_end_at },
      })
    );

    return this.getBooking(booking.id);
  }

  rescheduleBooking(
    actor: BookingActorContext,
    booking_id: string,
    dto: {
      new_start_at: string;
      new_end_at: string;
      reason: string;
    }
  ): Booking {
    const revision = this.proposeReschedule(actor, booking_id, dto);
    return this.acceptReschedule(actor, booking_id, revision.id);
  }

  getBookingRevisions(booking_id: string): BookingScheduleRevision[] {
    return this.repo.listScheduleRevisions(booking_id);
  }

  cancelBooking(
    actor: BookingActorContext,
    booking_id: string,
    dto: {
      reason_code: string;
      reason_text?: string | null;
    }
  ): Booking {
    const booking = this.getBooking(booking_id);

    const actorId = getActorId(actor);
    const isPrivileged = actor.roles?.some((r) =>
      ['OWNER', 'ADMIN', 'SERVICE_ADVISOR', 'MANAGER', 'SYSTEM_ADMIN'].includes(r)
    );
    if (!isPrivileged && booking.customer_user_id && booking.customer_user_id !== actorId) {
      throw new CanonicalAppError(
        ErrorCode.NOT_AUTHORIZED,
        `Access denied: not authorized to cancel booking '${booking_id}'`,
        403
      );
    }

    if (booking.status === 'CANCELLED') {
      return booking;
    }
    if (booking.status === 'COMPLETED' || booking.status === 'CHECKED_IN' || booking.status === 'IN_SERVICE') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot cancel booking once service is in progress (${booking.status})`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const canc: BookingCancellation = {
      id: generateCanonicalId('bkc'),
      booking_id: booking.id,
      cancelled_by: getActorId(actor),
      cancelled_by_role: actor.roles?.includes('OWNER') || actor.roles?.includes('ADMIN') || actor.roles?.includes('SERVICE_ADVISOR')
        ? 'PROVIDER'
        : 'CUSTOMER',
      reason_code: dto.reason_code,
      reason_text: dto.reason_text ?? null,
      cancelled_at: now,
    };
    this.repo.saveCancellation(canc);

    booking.status = 'CANCELLED';
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    if (booking.appointment) {
      booking.appointment.status = 'CANCELLED';
      booking.appointment.updated_at = now;
      this.repo.saveAppointment(booking.appointment);
    }

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'BOOKING_CANCELLED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Booking cancelled: ${dto.reason_code} - ${dto.reason_text || ''}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.cancelled',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id, reason_code: dto.reason_code },
      })
    );

    return this.getBooking(booking.id);
  }

  checkInBooking(
    actor: BookingActorContext,
    booking_id: string,
    dto?: {
      odometer_reading?: number;
      initial_odometer_km?: number;
      fuel_level?: string;
      fuel_level_percent?: number;
      customer_concerns?: string[];
      customer_stated_concerns?: string[];
      intake_notes?: string;
    }
  ): Booking {
    const booking = this.getBooking(booking_id);

    if (booking.status !== 'CONFIRMED' && booking.status !== 'REQUESTED') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot check in booking with status '${booking.status}'`,
        400
      );
    }

    const now = getCurrentUtcIsoString();

    // Transition or create Sprint 10 ServiceCase
    let serviceCaseId = booking.service_case_id;

    if (!serviceCaseId) {
      const items = booking.items || [];
      const concernsList = dto?.customer_concerns || dto?.customer_stated_concerns || [];
      const concerns = concernsList.map((c) => ({
        concern_type: 'CUSTOMER_REPORTED',
        description: c,
      }));

      if (concerns.length === 0 && items.length > 0) {
        concerns.push({
          concern_type: 'BOOKED_SERVICE',
          description: items.map((i) => i.description).join(', '),
        });
      }

      const sc = garageOperationsService.createServiceCase(
        { actor_id: getActorId(actor), roles: actor.roles || ['SERVICE_ADVISOR'] },
        {
          provider_id: booking.provider_id,
          branch_id: booking.branch_id || 'brn_main_01',
          vehicle_id: booking.vehicle_id,
          customer_user_id: booking.customer_user_id,
          source_type: ServiceCaseSourceType.APPOINTMENT_BOOKING,
          source_reference_id: booking.id,
          initial_concerns: concerns,
        }
      );
      serviceCaseId = sc.case.id;
    }

    booking.service_case_id = serviceCaseId;
    booking.status = 'CHECKED_IN';
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    if (booking.appointment) {
      booking.appointment.status = 'IN_PROGRESS';
      booking.appointment.updated_at = now;
      this.repo.saveAppointment(booking.appointment);
    }

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'VEHICLE_CHECKED_IN',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: `Vehicle checked in at workshop. ServiceCase: ${serviceCaseId}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.checked_in',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id, service_case: serviceCaseId },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id, service_case_id: serviceCaseId },
      })
    );

    return this.getBooking(booking.id);
  }

  completeBooking(actor: BookingActorContext, booking_id: string): Booking {
    const booking = this.getBooking(booking_id);

    if (booking.status !== 'CHECKED_IN' && booking.status !== 'IN_SERVICE') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot complete booking with status '${booking.status}'`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    booking.status = 'COMPLETED';
    booking.updated_at = now;
    this.repo.saveBooking(booking);

    if (booking.appointment) {
      booking.appointment.status = 'COMPLETED';
      booking.appointment.updated_at = now;
      this.repo.saveAppointment(booking.appointment);
    }

    this.repo.recordActivity({
      id: generateCanonicalId('bka'),
      booking_id: booking.id,
      action: 'BOOKING_COMPLETED',
      actor_id: getActorId(actor),
      actor_name: getActorName(actor),
      details: 'Booking and service successfully completed',
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'booking.completed',
        correlation_id: booking.id,
        subject_ids: { booking: booking.id, vehicle: booking.vehicle_id, provider: booking.provider_id },
        actor_id: getActorId(actor),
        payload: { booking_id: booking.id },
      })
    );

    return this.getBooking(booking.id);
  }

  // =========================================================================
  // 4. Estimates
  // =========================================================================

  createEstimate(
    actor: BookingActorContext,
    dto: {
      booking_id?: string | null;
      service_case_id?: string | null;
      provider_id: string;
      vehicle_id: string;
      valid_until?: string | null;
      notes?: string | null;
      line_items: Array<{
        line_type: LineItemType;
        description: string;
        related_service_offering_id?: string | null;
        related_work_recommendation_id?: string | null;
        quantity: number;
        unit_price_minor: number;
        currency?: string;
      }>;
    }
  ): ServiceEstimate {
    const now = getCurrentUtcIsoString();
    const estimateId = generateCanonicalId('est');

    let subtotal = 0;
    for (const item of dto.line_items) {
      const lineTotal = Math.round(item.quantity * item.unit_price_minor);
      subtotal += lineTotal;
    }

    const taxEstimate = Math.round(subtotal * 0.16); // 16% VAT
    const totalEstimate = subtotal + taxEstimate;

    const estimate: ServiceEstimate = {
      id: estimateId,
      booking_id: dto.booking_id ?? null,
      service_case_id: dto.service_case_id ?? null,
      provider_id: dto.provider_id,
      vehicle_id: dto.vehicle_id,
      version: 1,
      subtotal_minor: subtotal,
      tax_estimate_minor: taxEstimate,
      fees_estimate_minor: 0,
      total_estimate_minor: totalEstimate,
      currency: 'KES',
      status: 'DRAFT',
      valid_until: dto.valid_until ? normalizeToUtcIsoString(dto.valid_until) : null,
      notes: dto.notes ?? null,
      created_by: getActorId(actor),
      created_at: now,
    };

    this.repo.saveEstimate(estimate);

    for (const item of dto.line_items) {
      const lineTotal = Math.round(item.quantity * item.unit_price_minor);
      this.repo.saveEstimateLineItem({
        id: generateCanonicalId('eli'),
        estimate_id: estimateId,
        line_type: item.line_type,
        description: item.description,
        related_service_offering_id: item.related_service_offering_id ?? null,
        related_work_recommendation_id: item.related_work_recommendation_id ?? null,
        quantity: item.quantity,
        unit_price_minor: item.unit_price_minor,
        line_total_minor: lineTotal,
        currency: item.currency || 'KES',
        created_at: now,
      });
    }

    return this.repo.getEstimateById(estimateId)!;
  }

  // =========================================================================
  // 5. Service Quotes
  // =========================================================================

  createQuote(
    actor: BookingActorContext,
    dto: {
      booking_id?: string | null;
      service_case_id?: string | null;
      provider_id: string;
      branch_id?: string | null;
      vehicle_id: string;
      customer_user_id: string;
      quote_type?: QuoteType;
      valid_days?: number;
      terms_and_conditions?: string | null;
      supersedes_quote_id?: string | null;
      line_items: Array<{
        line_type: LineItemType;
        service_category?: string | null;
        description: string;
        quantity: number;
        unit_price_minor: number;
        related_recommended_work_item_id?: string | null;
        related_service_offering_id?: string | null;
        related_part_reference_id?: string | null;
        authorization_required?: boolean;
        is_optional?: boolean;
        dependency_group_id?: string | null;
      }>;
    }
  ): ServiceQuote {
    const now = getCurrentUtcIsoString();
    const quoteId = generateCanonicalId('qte');

    let version = 1;
    if (dto.supersedes_quote_id) {
      const previous = this.repo.getQuoteById(dto.supersedes_quote_id);
      if (previous) {
        version = previous.version + 1;
      }
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const quoteNumber = `QT-${new Date().getFullYear()}-${randomSuffix}`;

    const validDays = dto.valid_days || 14;
    const validUntil = new Date(Date.now() + validDays * 86400000).toISOString();

    let subtotal = 0;
    for (const it of dto.line_items) {
      subtotal += Math.round(it.quantity * it.unit_price_minor);
    }
    const taxRate = 0.16;
    const taxMinor = Math.round(subtotal * taxRate);
    const totalMinor = subtotal + taxMinor;

    const quote: ServiceQuote = {
      id: quoteId,
      booking_id: dto.booking_id ?? null,
      service_case_id: dto.service_case_id ?? null,
      provider_id: dto.provider_id,
      branch_id: dto.branch_id ?? null,
      vehicle_id: dto.vehicle_id,
      customer_user_id: dto.customer_user_id,
      quote_number: quoteNumber,
      version,
      status: 'DRAFT',
      quote_type: dto.quote_type || 'INITIAL',
      currency: 'KES',
      subtotal_minor: subtotal,
      tax_minor: taxMinor,
      tax_rate: taxRate,
      fees_minor: 0,
      discounts_minor: 0,
      total_minor: totalMinor,
      valid_until: validUntil,
      terms_and_conditions: dto.terms_and_conditions ?? 'Quote valid for 14 days. Prices include 16% VAT.',
      supersedes_quote_id: dto.supersedes_quote_id ?? null,
      service_authorization_id: null,
      created_by: getActorId(actor),
      created_at: now,
    };

    this.repo.saveQuote(quote);

    for (const it of dto.line_items) {
      const lineTotal = Math.round(it.quantity * it.unit_price_minor);
      this.repo.saveQuoteLineItem({
        id: generateCanonicalId('qli'),
        quote_id: quoteId,
        line_type: it.line_type,
        service_category: it.service_category ?? null,
        description: it.description,
        quantity: it.quantity,
        unit_price_minor: it.unit_price_minor,
        line_total_minor: lineTotal,
        related_recommended_work_item_id: it.related_recommended_work_item_id ?? null,
        related_service_offering_id: it.related_service_offering_id ?? null,
        related_part_reference_id: it.related_part_reference_id ?? null,
        authorization_required: it.authorization_required !== undefined ? it.authorization_required : true,
        is_optional: Boolean(it.is_optional),
        dependency_group_id: it.dependency_group_id ?? null,
        status: 'PROPOSED',
        created_at: now,
      });
    }

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'quote.created',
        correlation_id: quoteId,
        subject_ids: { quote: quoteId, vehicle: quote.vehicle_id, provider: quote.provider_id },
        actor_id: getActorId(actor),
        payload: { quote_id: quoteId, version, total_minor: totalMinor, quote_number: quoteNumber },
      })
    );

    return this.getQuote(quoteId);
  }

  getQuote(id: string): ServiceQuote {
    const quote = this.repo.getQuoteById(id);
    if (!quote) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Service quote '${id}' not found`, 404);
    }
    return quote;
  }

  listQuotes(filters: {
    booking_id?: string;
    service_case_id?: string;
    provider_id?: string;
    customer_user_id?: string;
    status?: QuoteStatus;
  }): ServiceQuote[] {
    return this.repo.listQuotes(filters);
  }

  issueQuote(actor: BookingActorContext, quote_id: string): ServiceQuote {
    const quote = this.getQuote(quote_id);

    if (quote.status !== 'DRAFT') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Only DRAFT quotes can be issued (current: ${quote.status})`,
        400
      );
    }

    if (!quote.line_items || quote.line_items.length === 0) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Cannot issue a quote without line items', 400);
    }

    const now = getCurrentUtcIsoString();
    quote.status = 'ISSUED';
    quote.issued_at = now;
    this.repo.saveQuote(quote);

    if (quote.booking_id) {
      this.repo.recordActivity({
        id: generateCanonicalId('bka'),
        booking_id: quote.booking_id,
        action: 'QUOTE_ISSUED',
        actor_id: getActorId(actor),
        actor_name: getActorName(actor),
        details: `Issued formal quote ${quote.quote_number} (v${quote.version}) for KES ${(quote.total_minor / 100).toFixed(2)}`,
        occurred_at: now,
      });
    }

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'quote.issued',
        correlation_id: quote.id,
        subject_ids: { quote: quote.id, vehicle: quote.vehicle_id, provider: quote.provider_id },
        actor_id: getActorId(actor),
        payload: { quote_id: quote.id, quote_number: quote.quote_number, total_minor: quote.total_minor },
      })
    );

    return this.getQuote(quote.id);
  }

  viewQuote(actor: BookingActorContext, quote_id: string): ServiceQuote {
    const quote = this.getQuote(quote_id);
    if (quote.status === 'ISSUED') {
      quote.status = 'VIEWED';
      quote.viewed_at = getCurrentUtcIsoString();
      this.repo.saveQuote(quote);
    }
    return quote;
  }

  acceptQuote(
    actor: BookingActorContext,
    quote_id: string,
    dto?: {
      accepted_line_item_ids?: string[];
      authorization_channel?: string;
      terms_version?: string;
      notes?: string;
    }
  ): ServiceQuote & { quote: ServiceQuote; authorization_id?: string } {
    const quote = this.getQuote(quote_id);

    if (quote.status !== 'ISSUED' && quote.status !== 'VIEWED') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot accept quote with status '${quote.status}'. Must be ISSUED or VIEWED`,
        400
      );
    }

    if (new Date(quote.valid_until) < new Date()) {
      quote.status = 'EXPIRED';
      this.repo.saveQuote(quote);
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION, 'Quote has expired', 400);
    }

    const now = getCurrentUtcIsoString();
    const lineItems = quote.line_items || [];

    // Check partial vs full acceptance
    const acceptedIds = dto?.accepted_line_item_ids;
    const isPartial = Boolean(acceptedIds && acceptedIds.length < lineItems.length);

    let authorizedAmountMinor = 0;
    const acceptedItemsToSave: Array<{ id: string; quote_line_item_id: string; line_total_minor: number; created_at: string }> = [];

    for (const item of lineItems) {
      const isAccepted = !acceptedIds || acceptedIds.includes(item.id);
      if (isAccepted) {
        item.status = 'ACCEPTED';
        this.repo.saveQuoteLineItem(item);
        authorizedAmountMinor += item.line_total_minor;
        acceptedItemsToSave.push({
          id: generateCanonicalId('qai'),
          quote_line_item_id: item.id,
          line_total_minor: item.line_total_minor,
          created_at: now,
        });
      } else {
        item.status = 'DECLINED';
        this.repo.saveQuoteLineItem(item);
      }
    }

    // Add proportional tax
    const totalAuthorizedMinor = Math.round(authorizedAmountMinor * (1 + quote.tax_rate));

    const acceptanceId = generateCanonicalId('qac');
    const acceptance: QuoteAcceptance = {
      id: acceptanceId,
      quote_id: quote.id,
      quote_version: quote.version,
      accepted_by_user_id: getActorId(actor),
      accepted_by_name: getActorName(actor) || 'Customer',
      authorization_channel: dto?.authorization_channel || 'DIGITAL_APP',
      is_partial: isPartial,
      amount_authorized_minor: totalAuthorizedMinor,
      currency: quote.currency,
      terms_version: dto?.terms_version || '1.0',
      accepted_at: now,
      service_authorization_id: null,
      metadata_json: dto?.notes ? JSON.stringify({ notes: dto.notes }) : null,
    };

    // If quote is linked to a ServiceCase or Booking, bridge directly to Workshop Service Authorization!
    let serviceCaseId = quote.service_case_id;
    if (!serviceCaseId && quote.booking_id) {
      const booking = this.repo.getBookingById(quote.booking_id);
      if (booking?.service_case_id) {
        serviceCaseId = booking.service_case_id;
      }
    }
    if (!serviceCaseId) {
      try {
        const sc = garageOperationsService.createServiceCase(
          { actor_id: getActorId(actor), roles: actor.roles || ['CUSTOMER', 'SERVICE_ADVISOR'] },
          {
            provider_id: quote.provider_id,
            branch_id: quote.branch_id || 'brn_main_01',
            vehicle_id: quote.vehicle_id,
            customer_user_id: quote.customer_user_id,
            source_type: ServiceCaseSourceType.APPOINTMENT_BOOKING,
            source_reference_id: quote.booking_id || quote.id,
            initial_concerns: [
              {
                concern_type: 'CUSTOMER_REPORTED',
                description: `Work authorized under quote ${quote.quote_number}`,
              },
            ],
          }
        );
        serviceCaseId = sc.case.id;
        if (quote.booking_id) {
          const booking = this.repo.getBookingById(quote.booking_id);
          if (booking) {
            booking.service_case_id = serviceCaseId;
            this.repo.saveBooking(booking);
          }
        }
      } catch (e) {
        console.warn('Could not auto-create service case for quote acceptance:', e);
      }
    }
    if (serviceCaseId) {
      quote.service_case_id = serviceCaseId;
    }

    let serviceAuthId: string | null = null;
    if (serviceCaseId) {
      try {
        const rwiIds: string[] = [];
        for (const it of acceptedItemsToSave) {
          const lineItem = lineItems.find((li) => li.id === it.quote_line_item_id);
          if (lineItem?.related_recommended_work_item_id) {
            rwiIds.push(lineItem.related_recommended_work_item_id);
          } else {
            const rwiId = generateCanonicalId('rwi');
            operationsRepository.createRecommendedWorkItem({
              id: rwiId,
              service_case_id: serviceCaseId,
              related_finding_id: null,
              related_issue_id: null,
              maintenance_task_id: null,
              service_category: lineItem?.service_category || 'GENERAL_REPAIR',
              description: lineItem?.description || 'Authorized line item',
              priority: RecommendedWorkPriority.RECOMMENDED_NOW,
              estimated_labor_hours: 1,
              estimated_labor_cost: (lineItem?.line_total_minor || 0) / 100,
              estimated_parts_cost: 0,
              currency: quote.currency,
              status: RecommendedWorkStatus.PROPOSED,
              declined_reason: null,
              declined_at: null,
              declined_by: null,
              created_at: now,
              updated_at: now,
            });
            rwiIds.push(rwiId);
          }
        }

        const scAuth = garageOperationsService.authorizeService(
          { actor_id: getActorId(actor), roles: actor.roles || ['CUSTOMER', 'SERVICE_ADVISOR'] },
          {
            service_case_id: serviceCaseId,
            authorization_type: ServiceAuthorizationType.INITIAL,
            authorization_channel: (dto?.authorization_channel as any) || AuthorizationChannel.DIGITAL_APPROVAL,
            authorized_by: getActorName(actor) || getActorId(actor),
            amount_authorized: totalAuthorizedMinor / 100,
            currency: quote.currency,
            recommended_work_item_ids: rwiIds.length > 0 ? rwiIds : acceptedItemsToSave.map((it) => it.quote_line_item_id),
            notes: `Authorized via quote ${quote.quote_number}`,
          }
        );
        serviceAuthId = scAuth.id;
        acceptance.service_authorization_id = serviceAuthId;
        quote.service_authorization_id = serviceAuthId;
      } catch (err) {
        console.warn('Could not auto-bridge quote acceptance to service case authorization:', err);
      }
    }

    this.repo.saveQuoteAcceptance(acceptance);

    for (const it of acceptedItemsToSave) {
      this.repo.saveQuoteAcceptanceItem({
        id: it.id,
        quote_acceptance_id: acceptanceId,
        quote_line_item_id: it.quote_line_item_id,
        line_total_minor: it.line_total_minor,
        created_at: it.created_at,
      });
    }

    quote.status = isPartial ? 'PARTIALLY_ACCEPTED' : 'ACCEPTED';
    quote.accepted_at = now;
    this.repo.saveQuote(quote);

    if (quote.booking_id) {
      this.repo.recordActivity({
        id: generateCanonicalId('bka'),
        booking_id: quote.booking_id,
        action: isPartial ? 'QUOTE_PARTIALLY_ACCEPTED' : 'QUOTE_ACCEPTED',
        actor_id: getActorId(actor),
        actor_name: getActorName(actor),
        details: `Customer accepted quote ${quote.quote_number}. Authorized KES ${(totalAuthorizedMinor / 100).toFixed(2)}`,
        occurred_at: now,
      });
    }

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: isPartial ? 'quote.partially_accepted' : 'quote.accepted',
        correlation_id: quote.id,
        subject_ids: { quote: quote.id, vehicle: quote.vehicle_id, provider: quote.provider_id },
        actor_id: getActorId(actor),
        payload: {
          quote_id: quote.id,
          quote_number: quote.quote_number,
          authorized_minor: totalAuthorizedMinor,
          is_partial: isPartial,
          service_authorization_id: serviceAuthId,
        },
      })
    );

    const finalQuote = this.getQuote(quote.id) as ServiceQuote & { quote: ServiceQuote; authorization_id?: string };
    finalQuote.quote = finalQuote;
    finalQuote.authorization_id = serviceAuthId || undefined;
    return finalQuote;
  }

  rejectQuote(
    actor: BookingActorContext,
    quote_id: string,
    dto: {
      reason_code: string;
      reason_text?: string | null;
    }
  ): ServiceQuote {
    const quote = this.getQuote(quote_id);

    if (quote.status !== 'ISSUED' && quote.status !== 'VIEWED') {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `Cannot reject quote with status '${quote.status}'`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const rejection: QuoteRejection = {
      id: generateCanonicalId('qrj'),
      quote_id: quote.id,
      quote_version: quote.version,
      rejected_by_user_id: getActorId(actor),
      rejected_by_name: getActorName(actor) || 'Customer',
      reason_code: dto.reason_code,
      reason_text: dto.reason_text ?? null,
      rejected_at: now,
    };

    this.repo.saveQuoteRejection(rejection);

    quote.status = 'REJECTED';
    quote.rejected_at = now;
    this.repo.saveQuote(quote);

    if (quote.booking_id) {
      this.repo.recordActivity({
        id: generateCanonicalId('bka'),
        booking_id: quote.booking_id,
        action: 'QUOTE_REJECTED',
        actor_id: getActorId(actor),
        actor_name: getActorName(actor),
        details: `Customer declined quote ${quote.quote_number}: ${dto.reason_code} - ${dto.reason_text || ''}`,
        occurred_at: now,
      });
    }

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'quote.rejected',
        correlation_id: quote.id,
        subject_ids: { quote: quote.id, vehicle: quote.vehicle_id, provider: quote.provider_id },
        actor_id: getActorId(actor),
        payload: { quote_id: quote.id, reason_code: dto.reason_code },
      })
    );

    return this.getQuote(quote.id);
  }

  reviseQuote(
    actor: BookingActorContext,
    previous_quote_id: string,
    dto: {
      line_items: Array<{
        line_type: LineItemType;
        service_category?: string | null;
        description: string;
        quantity: number;
        unit_price_minor: number;
        related_recommended_work_item_id?: string | null;
        related_service_offering_id?: string | null;
        related_part_reference_id?: string | null;
        authorization_required?: boolean;
        is_optional?: boolean;
        dependency_group_id?: string | null;
      }>;
      terms_and_conditions?: string | null;
      valid_days?: number;
    }
  ): ServiceQuote {
    const previous = this.getQuote(previous_quote_id);

    // Mark previous as superseded
    previous.status = 'SUPERSEDED';
    this.repo.saveQuote(previous);

    // Create revision (version N+1)
    const revision = this.createQuote(actor, {
      booking_id: previous.booking_id,
      service_case_id: previous.service_case_id,
      provider_id: previous.provider_id,
      branch_id: previous.branch_id,
      vehicle_id: previous.vehicle_id,
      customer_user_id: previous.customer_user_id,
      quote_type: 'REVISION',
      valid_days: dto.valid_days || 14,
      terms_and_conditions: dto.terms_and_conditions || previous.terms_and_conditions,
      supersedes_quote_id: previous.id,
      line_items: dto.line_items,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'quote.revised',
        correlation_id: revision.id,
        subject_ids: { quote: revision.id, previous_quote: previous.id, vehicle: revision.vehicle_id },
        actor_id: getActorId(actor),
        payload: { quote_id: revision.id, previous_quote_id: previous.id, version: revision.version },
      })
    );

    return revision;
  }

  // =========================================================================
  // 7. Background Jobs & Idempotent Sweepers (GAR-013 §95-§97, GAR-036)
  // =========================================================================

  processCapacityHoldCleanup(asOfUtc?: string): { expiredCount: number } {
    const cutoff = asOfUtc || getCurrentUtcIsoString();
    const count = this.repo.expireActiveCapacityHoldsBefore(cutoff);
    return { expiredCount: count };
  }

  processQuoteExpiration(asOfUtc?: string): { expiredCount: number; quoteIds: string[] } {
    const cutoff = asOfUtc || getCurrentUtcIsoString();
    const quotes = this.repo.getIssuedQuotesExpiringBefore(cutoff);
    const quoteIds: string[] = [];

    for (const quote of quotes) {
      quote.status = 'EXPIRED';
      this.repo.saveQuote(quote);
      quoteIds.push(quote.id);

      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'quote.expired',
          correlation_id: quote.id,
          subject_ids: { quote: quote.id, vehicle: quote.vehicle_id },
          actor_id: 'sys_cron_job',
          payload: { quote_id: quote.id, valid_until: quote.valid_until },
        })
      );
    }

    return { expiredCount: quoteIds.length, quoteIds };
  }

  processStaleBookingRequests(timeoutHours: number = 48, asOfUtc?: string): { expiredCount: number; bookingIds: string[] } {
    const now = asOfUtc ? new Date(asOfUtc) : new Date();
    const cutoffDate = new Date(now.getTime() - timeoutHours * 3600 * 1000);
    const cutoff = cutoffDate.toISOString();

    const staleBookings = this.repo.getStaleBookingRequestsBefore(cutoff);
    const bookingIds: string[] = [];

    for (const booking of staleBookings) {
      booking.status = 'EXPIRED';
      booking.updated_at = getCurrentUtcIsoString();
      this.repo.saveBooking(booking);
      bookingIds.push(booking.id);

      this.repo.recordActivity({
        id: generateCanonicalId('act'),
        booking_id: booking.id,
        action: 'EXPIRED_DUE_TO_INACTIVITY',
        actor_id: 'sys_cron_job',
        actor_name: 'Garage OS Scheduler',
        details: `Request expired automatically after ${timeoutHours}h without provider confirmation`,
        occurred_at: booking.updated_at,
      });

      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'booking.expired',
          correlation_id: booking.id,
          subject_ids: { booking: booking.id, vehicle: booking.vehicle_id },
          actor_id: 'sys_cron_job',
          payload: { booking_id: booking.id, requested_start_at: booking.requested_start_at },
        })
      );
    }

    return { expiredCount: bookingIds.length, bookingIds };
  }

  processAppointmentReminders(windowHours: number = 24, asOfUtc?: string): { remindedCount: number; appointmentIds: string[] } {
    const now = asOfUtc ? new Date(asOfUtc) : new Date();
    const startIso = now.toISOString();
    const endIso = new Date(now.getTime() + windowHours * 3600 * 1000).toISOString();

    const appointments = this.repo.getAppointmentsInRange(startIso, endIso);
    const appointmentIds: string[] = [];

    for (const apt of appointments) {
      appointmentIds.push(apt.id);
      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'booking.appointment_reminder',
          correlation_id: apt.booking_id,
          subject_ids: { appointment: apt.id, booking: apt.booking_id },
          actor_id: 'sys_cron_job',
          payload: {
            appointment_id: apt.id,
            booking_id: apt.booking_id,
            scheduled_start_at: apt.scheduled_start_at,
            timezone: apt.timezone,
          },
        })
      );
    }

    return { remindedCount: appointmentIds.length, appointmentIds };
  }
}

export const bookingService = new BookingService();
