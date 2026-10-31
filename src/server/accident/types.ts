export enum AccidentStatus {
  DRAFT = 'DRAFT',
  RECORDED = 'RECORDED',
  REPAIR_IN_PROGRESS = 'REPAIR_IN_PROGRESS',
  CLOSED = 'CLOSED',
}

export enum AccidentSeverity {
  UNKNOWN = 'UNKNOWN',
  MINOR = 'MINOR',
  MODERATE = 'MODERATE',
  MAJOR = 'MAJOR',
  TOTAL_LOSS_REPORTED = 'TOTAL_LOSS_REPORTED',
}

export enum TriState {
  UNKNOWN = 'UNKNOWN',
  YES = 'YES',
  NO = 'NO',
}

export enum AccidentParticipantType {
  OTHER_DRIVER = 'OTHER_DRIVER',
  PASSENGER = 'PASSENGER',
  PEDESTRIAN = 'PEDESTRIAN',
  CYCLIST = 'CYCLIST',
  PROPERTY_OWNER = 'PROPERTY_OWNER',
  OTHER = 'OTHER',
}

export enum AccidentEvidenceType {
  SCENE_PHOTO = 'SCENE_PHOTO',
  VEHICLE_PHOTO = 'VEHICLE_PHOTO',
  OTHER_VEHICLE_PHOTO = 'OTHER_VEHICLE_PHOTO',
  DOCUMENT = 'DOCUMENT',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  OTHER = 'OTHER',
}

export enum AccidentReferenceType {
  POLICE_REFERENCE = 'POLICE_REFERENCE',
  INSURANCE_CLAIM = 'INSURANCE_CLAIM',
  INSPECTION_REFERENCE = 'INSPECTION_REFERENCE',
  LEGAL_REFERENCE = 'LEGAL_REFERENCE',
  OTHER = 'OTHER',
}

export enum AccidentReferenceVerificationStatus {
  OWNER_REPORTED = 'OWNER_REPORTED',
  DOCUMENT_SUPPORTED = 'DOCUMENT_SUPPORTED',
  EXTERNAL_VERIFIED = 'EXTERNAL_VERIFIED',
}

export enum AccidentHandoffType {
  TOW_REQUEST = 'TOW_REQUEST',
  ROADSIDE_INCIDENT = 'ROADSIDE_INCIDENT',
  SERVICE_CASE = 'SERVICE_CASE',
  BOOKING = 'BOOKING',
}

export interface AccidentIncident {
  id: string;
  user_id: string;
  vehicle_id: string;
  status: AccidentStatus;
  incident_type: string;
  severity: AccidentSeverity;
  occurred_at: string;
  recorded_at: string;
  summary: string;
  location_label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy_meters?: number | null;
  location_sharing_authorized: boolean;
  police_attended: TriState;
  injuries_reported: TriState;
  vehicle_drivable: TriState;
  timeline_entry_id?: string | null;
  version: number;
  finalized_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccidentParticipant {
  id: string;
  accident_id: string;
  participant_type: AccidentParticipantType;
  display_label: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  vehicle_registration?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  insurer_name?: string | null;
  policy_reference?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface AccidentWitness {
  id: string;
  accident_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  consent_to_contact: TriState;
  created_at: string;
}

export interface AccidentDamageObservation {
  id: string;
  accident_id: string;
  vehicle_area: string;
  severity: 'UNKNOWN' | 'COSMETIC' | 'MINOR' | 'MODERATE' | 'SEVERE';
  description: string;
  source_type: 'OWNER_OBSERVATION' | 'PROVIDER_OBSERVATION' | 'EXTERNAL_DOCUMENT';
  created_at: string;
}

export interface AccidentEvidence {
  id: string;
  accident_id: string;
  file_id: string;
  evidence_type: AccidentEvidenceType;
  description?: string | null;
  captured_at?: string | null;
  source_type: 'OWNER_PROVIDED' | 'PROVIDER_PROVIDED' | 'EXTERNAL_DOCUMENT';
  privacy_class: 'PRIVATE' | 'SHAREABLE_INCIDENT_EVIDENCE';
  created_at: string;
}

export interface AccidentExternalReference {
  id: string;
  accident_id: string;
  reference_type: AccidentReferenceType;
  provider_name?: string | null;
  reference_number: string;
  verification_status: AccidentReferenceVerificationStatus;
  notes?: string | null;
  created_at: string;
}

export interface AccidentHandoff {
  id: string;
  accident_id: string;
  handoff_type: AccidentHandoffType;
  target_reference_id: string;
  status: 'LINKED' | 'SUPERSEDED' | 'CANCELLED';
  notes?: string | null;
  created_at: string;
}

export interface AccidentAddendum {
  id: string;
  accident_id: string;
  author_user_id: string;
  addendum_type: 'OWNER_NOTE' | 'CORRECTION_NOTE' | 'REPAIR_UPDATE' | 'EXTERNAL_REFERENCE_UPDATE';
  text: string;
  created_at: string;
}

export interface AccidentAggregate {
  incident: AccidentIncident;
  participants: AccidentParticipant[];
  witnesses: AccidentWitness[];
  damage_observations: AccidentDamageObservation[];
  evidence: AccidentEvidence[];
  external_references: AccidentExternalReference[];
  handoffs: AccidentHandoff[];
  addenda: AccidentAddendum[];
}

export interface CreateAccidentInput {
  vehicle_id: string;
  incident_type: string;
  severity?: AccidentSeverity;
  occurred_at: string;
  summary: string;
  location_label?: string | null;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
  } | null;
  location_sharing_authorized?: boolean;
  police_attended?: TriState;
  injuries_reported?: TriState;
  vehicle_drivable?: TriState;
}

export interface UpdateAccidentDraftInput {
  incident_type?: string;
  severity?: AccidentSeverity;
  occurred_at?: string;
  summary?: string;
  location_label?: string | null;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
  } | null;
  location_sharing_authorized?: boolean;
  police_attended?: TriState;
  injuries_reported?: TriState;
  vehicle_drivable?: TriState;
}
