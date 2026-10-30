/**
 * GAR-013: Booking, Scheduling, Quotes & Service Transaction Architecture
 * Canonical Types & Enums
 */

export type DeliveryMode = 'WORKSHOP' | 'MOBILE' | 'PICKUP_AND_DELIVERY';
export type BookingMode = 'INSTANT_CONFIRMATION' | 'PROVIDER_CONFIRMATION' | 'QUOTE_FIRST';
export type PricingModel = 'FIXED' | 'STARTING_FROM' | 'TIME_AND_MATERIALS' | 'DIAGNOSTIC_FEE' | 'CUSTOM_QUOTE';
export type ServiceOfferingStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type BookingStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type RevisionStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
export type CapacityHoldStatus = 'ACTIVE' | 'EXPIRED' | 'CONSUMED' | 'RELEASED';

export type QuoteStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'PARTIALLY_ACCEPTED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'WITHDRAWN';

export type QuoteType = 'INITIAL' | 'SUPPLEMENTARY' | 'REVISION' | 'ADDITIONAL_WORK';
export type LineItemType = 'LABOR' | 'PART' | 'CONSUMABLE' | 'DIAGNOSTIC' | 'FEE' | 'DISCOUNT' | 'SERVICE';
export type LineItemStatus = 'PROPOSED' | 'ACCEPTED' | 'DECLINED';
export type EstimateStatus = 'DRAFT' | 'SHARED' | 'SUPERSEDED' | 'EXPIRED';

export interface ServiceOffering {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  service_category_id: string;
  capability_id?: string | null;
  name: string;
  description?: string | null;
  delivery_mode: DeliveryMode;
  booking_mode: BookingMode;
  estimated_duration_minutes?: number | null;
  pricing_model: PricingModel;
  base_price_minor?: number | null;
  currency: string;
  requires_inspection: boolean;
  requires_quote: boolean;
  requires_vehicle: boolean;
  status: ServiceOfferingStatus;
  created_at: string;
  updated_at: string;
}

export interface ProviderCapacityRule {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  service_category_id?: string | null;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  start_time: string; // '08:00'
  end_time: string; // '17:00'
  max_concurrent_bookings: number;
  slot_duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  max_advance_days: number;
  timezone: string;
  effective_from?: string | null;
  effective_to?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderScheduleBlock {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  resource_id?: string | null;
  start_at: string;
  end_at: string;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface CapacityHold {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  slot_start_at: string;
  slot_end_at: string;
  customer_user_id: string;
  booking_id?: string | null;
  status: CapacityHoldStatus;
  expires_at: string;
  created_at: string;
}

export interface AvailableSlot {
  start_at: string;
  end_at: string;
  slot_start_at?: string;
  slot_end_at?: string;
  capacity_total: number;
  capacity_available: number;
  capacity_remaining?: number;
  is_available: boolean;
  available?: boolean;
  hold_id?: string | null;
}

export interface Booking {
  id: string;
  customer_user_id: string;
  vehicle_id: string;
  provider_id: string;
  branch_id?: string | null;
  service_offering_id?: string | null;
  booking_type: string;
  booking_mode: BookingMode;
  status: BookingStatus;
  requested_start_at?: string | null;
  requested_end_at?: string | null;
  confirmed_start_at?: string | null;
  confirmed_end_at?: string | null;
  proposed_start_at?: string | null;
  proposed_end_at?: string | null;
  delivery_mode: DeliveryMode;
  service_address?: string | null;
  customer_notes?: string | null;
  source_type: string;
  related_maintenance_task_id?: string | null;
  related_issue_id?: string | null;
  service_case_id?: string | null;
  created_at: string;
  updated_at: string;
  // Hydrated sub-records
  items?: BookingItem[];
  appointment?: ServiceAppointment | null;
  quotes?: ServiceQuote[];
  estimates?: ServiceEstimate[];
  active_revision?: BookingScheduleRevision | null;
  cancellation?: BookingCancellation | null;
}

export interface BookingItem {
  id: string;
  booking_id: string;
  service_offering_id?: string | null;
  service_category_id: string;
  related_maintenance_task_id?: string | null;
  related_issue_id?: string | null;
  description: string;
  quantity: number;
  estimated_duration_minutes?: number | null;
  status: string;
  created_at: string;
}

export interface ServiceAppointment {
  id: string;
  booking_id: string;
  provider_id: string;
  branch_id?: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
  timezone: string;
  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
}

export interface BookingScheduleRevision {
  id: string;
  booking_id: string;
  previous_start_at: string;
  previous_end_at: string;
  new_start_at: string;
  new_end_at: string;
  requested_by: string;
  requested_by_role: string;
  reason: string;
  requested_at: string;
  accepted_at?: string | null;
  status: RevisionStatus;
  created_at: string;
}

export interface BookingCancellation {
  id: string;
  booking_id: string;
  cancelled_by: string;
  cancelled_by_role: string;
  reason_code: string;
  reason_text?: string | null;
  cancelled_at: string;
}

export interface ServiceEstimate {
  id: string;
  booking_id?: string | null;
  service_case_id?: string | null;
  provider_id: string;
  vehicle_id: string;
  version: number;
  subtotal_minor: number;
  tax_estimate_minor: number;
  fees_estimate_minor: number;
  total_estimate_minor: number;
  currency: string;
  status: EstimateStatus;
  valid_until?: string | null;
  notes?: string | null;
  created_by: string;
  created_at: string;
  line_items?: EstimateLineItem[];
}

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  line_type: LineItemType;
  description: string;
  related_service_offering_id?: string | null;
  related_work_recommendation_id?: string | null;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  currency: string;
  created_at: string;
}

export interface ServiceQuote {
  id: string;
  booking_id?: string | null;
  service_case_id?: string | null;
  provider_id: string;
  branch_id?: string | null;
  vehicle_id: string;
  customer_user_id: string;
  quote_number: string;
  version: number;
  status: QuoteStatus;
  quote_type: QuoteType;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  tax_rate: number;
  fees_minor: number;
  discounts_minor: number;
  total_minor: number;
  valid_until: string;
  terms_and_conditions?: string | null;
  supersedes_quote_id?: string | null;
  service_authorization_id?: string | null;
  created_by: string;
  created_at: string;
  issued_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  withdrawal_reason?: string | null;
  line_items?: QuoteLineItem[];
  acceptance?: QuoteAcceptance | null;
  rejection?: QuoteRejection | null;
}

export interface QuoteLineItem {
  id: string;
  quote_id: string;
  line_type: LineItemType;
  service_category?: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  related_recommended_work_item_id?: string | null;
  related_service_offering_id?: string | null;
  related_part_reference_id?: string | null;
  authorization_required: boolean;
  is_optional: boolean;
  dependency_group_id?: string | null;
  status: LineItemStatus;
  created_at: string;
}

export interface QuoteAcceptance {
  id: string;
  quote_id: string;
  quote_version: number;
  accepted_by_user_id: string;
  accepted_by_name: string;
  authorization_channel: string;
  is_partial: boolean;
  amount_authorized_minor: number;
  currency: string;
  terms_version: string;
  accepted_at: string;
  service_authorization_id?: string | null;
  metadata_json?: string | null;
  accepted_items?: QuoteAcceptanceItem[];
}

export interface QuoteAcceptanceItem {
  id: string;
  quote_acceptance_id: string;
  quote_line_item_id: string;
  line_total_minor: number;
  created_at: string;
}

export interface QuoteRejection {
  id: string;
  quote_id: string;
  quote_version: number;
  rejected_by_user_id: string;
  rejected_by_name: string;
  reason_code: string;
  reason_text?: string | null;
  rejected_at: string;
}

export interface BookingActivity {
  id: string;
  booking_id: string;
  action: string;
  actor_id: string;
  actor_name?: string | null;
  details?: string | null;
  occurred_at: string;
}
