/**
 * GAR-017 safety notification adapter boundary.
 *
 * The default adapter deliberately does not pretend to send messages. A real
 * SMS/email provider can replace it without changing the SOS state machine.
 */

export interface SafetyNotificationRequest {
  channel: 'SMS' | 'EMAIL';
  destination: string;
  incident_id: string;
  contact_id: string;
  message: string;
}

export interface SafetyNotificationResult {
  outcome: 'PROVIDER_ACCEPTED' | 'DELIVERED' | 'FAILED' | 'NOT_CONFIGURED';
  provider_name?: string;
  provider_message_id?: string;
  failure_code?: string;
  failure_message?: string;
}

export interface SafetyNotificationAdapter {
  send(request: SafetyNotificationRequest): Promise<SafetyNotificationResult>;
}

class UnconfiguredSafetyNotificationAdapter implements SafetyNotificationAdapter {
  async send(): Promise<SafetyNotificationResult> {
    return {
      outcome: 'NOT_CONFIGURED',
      provider_name: 'UNCONFIGURED',
      failure_code: 'SAFETY_NOTIFICATION_PROVIDER_NOT_CONFIGURED',
      failure_message: 'No production safety notification transport is configured.',
    };
  }
}

let adapter: SafetyNotificationAdapter = new UnconfiguredSafetyNotificationAdapter();

export function getSafetyNotificationAdapter(): SafetyNotificationAdapter {
  return adapter;
}

/** Test/integration hook. Production bootstrap should inject a real adapter later. */
export function setSafetyNotificationAdapter(next: SafetyNotificationAdapter | null): void {
  adapter = next || new UnconfiguredSafetyNotificationAdapter();
}
