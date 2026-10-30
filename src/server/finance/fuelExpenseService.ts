/**
 * Canonical Fuel, Expense & Total Cost of Ownership Service (GAR-009)
 *
 * Implements business logic for:
 * - Fuel logging, unit/currency normalization, odometer synchronization
 * - Full-to-full consumption calculations & efficiency anomaly detection
 * - Direct expense management & recurring cost projections
 * - Multi-currency total cost of ownership analytics
 * - Strict multi-tenant RBAC and actor isolation
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalPermission } from '../identity/rbac';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { vehiclePolicy } from '../vehicle/vehiclePolicy';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { vehicleService } from '../vehicle/vehicleService';
import { FuelType, OdometerUnit } from '../vehicle/types';
import { recordAuditEvent } from '../security/audit';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { CanonicalActorType } from '../../shared/types';
import { metrics } from '../observability/metrics';

import {
  CostType,
  ExpenseCategory,
  ExpenseSourceType,
  ExpenseStatus,
  FillType,
  FuelEconomyConfidence,
  FuelEconomyInterval,
  FuelEntry,
  FuelQuantityUnit,
  FuelSourceType,
  FuelSummaryDto,
  RecurringFrequency,
  RecurringStatus,
  RecurringVehicleExpense,
  TotalCostOfOwnershipSummary,
  VehicleExpense,
  VehicleExpenseCorrection,
} from './types';
import { fuelExpenseRepository, FuelExpenseRepository } from './fuelExpenseRepository';
import { FuelEconomyEngine } from './fuelEconomy';
import { FuelAnomalyEngine } from './anomalyEngine';
import { TcoEngine } from './tcoEngine';
import { MoneyUtil } from './money';

export interface RecordFuelEntryDTO {
  fueled_at?: string;
  odometer_value?: number | null;
  odometer_unit?: string | null;
  fuel_type?: string;
  quantity: number;
  quantity_unit?: FuelQuantityUnit;
  total_cost: number;
  currency?: string;
  fill_type?: FillType;
  tank_level_before?: number | null;
  tank_level_after?: number | null;
  station_name?: string | null;
  location_reference?: string | null;
  source_type?: FuelSourceType;
  notes?: string | null;
}

export interface CorrectFuelEntryDTO {
  fueled_at?: string;
  odometer_value?: number | null;
  odometer_unit?: string | null;
  fuel_type?: string;
  quantity?: number;
  quantity_unit?: FuelQuantityUnit;
  total_cost?: number;
  currency?: string;
  fill_type?: FillType;
  station_name?: string | null;
  notes?: string | null;
  correction_reason: string;
}

export interface RecordVehicleExpenseDTO {
  expense_category: ExpenseCategory;
  expense_subcategory?: string | null;
  occurred_at?: string;
  amount: number;
  currency?: string;
  cost_type?: CostType;
  status?: ExpenseStatus;
  description: string;
  source_type?: ExpenseSourceType;
  source_reference_type?: string | null;
  source_reference_id?: string | null;
  merchant_provider_id?: string | null;
  recurring_expense_id?: string | null;
  odometer_km?: number | null;
  receipt_document_id?: string | null;
  notes?: string | null;
}

export interface CorrectVehicleExpenseDTO {
  amount?: number;
  currency?: string;
  expense_category?: ExpenseCategory;
  description?: string;
  occurred_at?: string;
  reason: string;
}

export interface CreateRecurringExpenseDTO {
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency?: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string | null;
  auto_create_expense?: boolean;
}

export class FuelExpenseService {
  constructor(private repo: FuelExpenseRepository = fuelExpenseRepository) {}

  // ==================== FUEL DOMAIN ====================

  /**
   * Records a new fuel entry, verifies compatibility, updates odometer,
   * calculates economy intervals, and evaluates efficiency anomalies.
   */
  async recordFuelEntry(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: RecordFuelEntryDTO
  ): Promise<{ entry: FuelEntry; intervals: FuelEconomyInterval[] }> {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_FUEL_RECORD);

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        `Vehicle ${vehicleId} not found`,
        404
      );
    }

    // Validation
    if (typeof dto.quantity !== 'number' || dto.quantity <= 0 || isNaN(dto.quantity)) {
      throw new CanonicalAppError(
        ErrorCode.FUEL_INVALID_QUANTITY,
        'Fuel quantity must be a strictly positive number',
        400
      );
    }

    if (typeof dto.total_cost !== 'number' || dto.total_cost < 0 || isNaN(dto.total_cost)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_AMOUNT,
        'Total fuel cost must be a non-negative number',
        400
      );
    }

    const currency = MoneyUtil.normalizeCurrency(dto.currency || 'KES');
    const quantityUnit = dto.quantity_unit || FuelQuantityUnit.LITRE;
    const quantityLitres = FuelEconomyEngine.normalizeToLitres(dto.quantity, quantityUnit);
    const fillType = dto.fill_type || FillType.FULL;
    const sourceType = dto.source_type || FuelSourceType.OWNER_ENTERED;
    const fueledAt = dto.fueled_at || getCurrentUtcIsoString();
    const recordedAt = getCurrentUtcIsoString();

    // Fuel Type Compatibility Check (GAR-009 §11, §87)
    const fuelTypeStr = dto.fuel_type ? dto.fuel_type.toUpperCase() : vehicle.fuel_type;
    this.assertFuelTypeCompatibility(vehicle.fuel_type, fuelTypeStr);

    // Odometer normalization and synchronization
    let odometerKm: number | null = null;
    const odoUnit = dto.odometer_unit ? dto.odometer_unit.toUpperCase() : 'KM';
    if (typeof dto.odometer_value === 'number' && dto.odometer_value > 0) {
      odometerKm = FuelEconomyEngine.normalizeDistanceToKm(dto.odometer_value, odoUnit);

      // Synchronize with Canonical Odometer Timeline if permitted
      try {
        vehicleService.recordOdometer(actor, vehicleId, {
          value: dto.odometer_value,
          unit: odoUnit === 'MILES' ? OdometerUnit.MILES : OdometerUnit.KM,
          observed_at: fueledAt,
          source_class: 'FUEL_PURCHASE',
          notes: `Odometer captured during fuel purchase (${quantityLitres}L at ${currency} ${dto.total_cost})`,
        });
      } catch (err: any) {
        // If odometer service threw regression or flag, record reading still on fuel entry
        // but log and proceed so fuel record is not lost
      }
    }

    const pricePerUnit = MoneyUtil.divide(dto.total_cost, dto.quantity, currency);
    const entryId = generateCanonicalId('fuel');

    const entry: FuelEntry = {
      id: entryId,
      vehicle_id: vehicleId,
      fueled_at: fueledAt,
      recorded_at: recordedAt,
      odometer_value: dto.odometer_value ?? null,
      odometer_unit: odoUnit,
      odometer_km: odometerKm,
      fuel_type: fuelTypeStr,
      quantity: dto.quantity,
      quantity_unit: quantityUnit,
      quantity_litres: quantityLitres,
      total_cost: MoneyUtil.roundMoney(dto.total_cost, currency),
      currency,
      price_per_unit: pricePerUnit,
      fill_type: fillType,
      tank_level_before: dto.tank_level_before ?? null,
      tank_level_after: dto.tank_level_after ?? null,
      station_name: dto.station_name ? dto.station_name.trim() : null,
      location_reference: dto.location_reference ? dto.location_reference.trim() : null,
      source_type: sourceType,
      actor_id: actor.user_id,
      is_corrected: false,
      correction_of_id: null,
      notes: dto.notes ? dto.notes.trim() : null,
      created_at: recordedAt,
      updated_at: recordedAt,
    };

    this.repo.createFuelEntry(entry);
    metrics.recordFuelEntry();

    // Create synchronized vehicle expense for fuel spend (GAR-009 §23, §24)
    const expenseId = generateCanonicalId('vexp');
    const fuelExpense: VehicleExpense = {
      id: expenseId,
      vehicle_id: vehicleId,
      expense_category: ExpenseCategory.FUEL,
      expense_subcategory: 'FUEL_FILL',
      occurred_at: fueledAt,
      recorded_at: recordedAt,
      amount: entry.total_cost,
      currency,
      cost_type: CostType.ACTUAL,
      status: ExpenseStatus.CONFIRMED,
      description: `Fuel purchase - ${entry.quantity_litres}L at ${entry.station_name || 'Station'}`,
      source_type: ExpenseSourceType.SYSTEM_DERIVED,
      source_reference_type: 'FUEL_ENTRY',
      source_reference_id: entryId,
      merchant_provider_id: null,
      recurring_expense_id: null,
      odometer_km: odometerKm,
      receipt_document_id: null,
      notes: entry.notes,
      is_corrected: false,
      correction_of_id: null,
      created_by: actor.user_id,
      created_at: recordedAt,
      updated_at: recordedAt,
    };
    this.repo.createExpense(fuelExpense);
    metrics.recordVehicleExpense('FUEL');

    // Re-evaluate fuel economy intervals across all entries
    const allEntries = this.repo.getFuelEntriesForVehicle(vehicleId);
    const intervals = FuelEconomyEngine.calculateIntervals(allEntries);
    this.repo.saveIntervals(vehicleId, intervals);
    if (intervals.length > 0) {
      metrics.recordFuelEconomyCalculation();
    }

    // Evaluate vehicle-specific efficiency snapshot & anomalies (GAR-009 §40-44)
    const snapshot = FuelAnomalyEngine.evaluateEfficiency(vehicleId, intervals);
    this.repo.saveSnapshot(snapshot);
    if (snapshot.anomaly_detected) {
      metrics.recordFuelEfficiencyAnomaly();
    }

    // Audit logging
    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'FUEL_ENTRY_RECORDED',
      resource_type: 'fuel_entry',
      resource_id: entryId,
      correlation_id: `fuel_rec_${entryId}`,
      source: 'finance-domain',
      metadata: {
        vehicle_id: vehicleId,
        quantity_litres: quantityLitres,
        total_cost: entry.total_cost,
        currency,
        intervals_calculated: intervals.length,
        anomaly_detected: snapshot.anomaly_detected,
      },
    });

    // Outbox events
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'fuel.entry_recorded',
      producer: 'finance-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `fuel_rec_${entryId}`,
      payload: {
        entry,
        intervals_count: intervals.length,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    if (snapshot.anomaly_detected) {
      const anomalyEnvelope = createCanonicalEventEnvelope({
        type: 'fuel.efficiency_anomaly_observed',
        producer: 'finance-domain',
        actor_id: actor.user_id,
        actor_type: CanonicalActorType.SYSTEM_WORKER,
        subject_ids: { vehicle: vehicleId },
        correlation_id: `fuel_anom_${snapshot.id}`,
        payload: {
          snapshot,
        },
      });
      enqueueOutboxEvent(anomalyEnvelope);
    }

    return { entry, intervals };
  }

  /**
   * Corrects a fuel entry while preserving historical provenance.
   */
  async correctFuelEntry(
    actor: AuthenticatedActorContext,
    fuelEntryId: string,
    dto: CorrectFuelEntryDTO
  ): Promise<{ entry: FuelEntry; intervals: FuelEconomyInterval[] }> {
    const original = this.repo.getFuelEntryById(fuelEntryId);
    if (!original) {
      throw new CanonicalAppError(
        ErrorCode.FUEL_ENTRY_NOT_FOUND,
        `Fuel entry ${fuelEntryId} not found`,
        404
      );
    }

    vehiclePolicy.assertVehicleAccess(
      actor,
      original.vehicle_id,
      CanonicalPermission.VEHICLE_FUEL_CORRECT
    );

    if (!dto.correction_reason || dto.correction_reason.trim().length === 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Correction reason is mandatory',
        400
      );
    }

    // Mark original as corrected
    this.repo.markFuelEntryCorrected(original.id);

    // Create replacement entry
    const newQuantity = dto.quantity ?? original.quantity;
    const newQuantityUnit = dto.quantity_unit ?? original.quantity_unit;
    const newQuantityLitres = FuelEconomyEngine.normalizeToLitres(newQuantity, newQuantityUnit);
    const newCost = dto.total_cost ?? original.total_cost;
    const newCurrency = MoneyUtil.normalizeCurrency(dto.currency ?? original.currency);
    const newOdoValue = dto.odometer_value !== undefined ? dto.odometer_value : original.odometer_value;
    const newOdoUnit = dto.odometer_unit ?? original.odometer_unit;
    const newOdoKm =
      newOdoValue && newOdoValue > 0
        ? FuelEconomyEngine.normalizeDistanceToKm(newOdoValue, newOdoUnit || 'KM')
        : null;

    const replacementId = generateCanonicalId('fuel');
    const now = getCurrentUtcIsoString();

    const replacement: FuelEntry = {
      id: replacementId,
      vehicle_id: original.vehicle_id,
      fueled_at: dto.fueled_at ?? original.fueled_at,
      recorded_at: now,
      odometer_value: newOdoValue,
      odometer_unit: newOdoUnit,
      odometer_km: newOdoKm,
      fuel_type: dto.fuel_type ?? original.fuel_type,
      quantity: newQuantity,
      quantity_unit: newQuantityUnit,
      quantity_litres: newQuantityLitres,
      total_cost: MoneyUtil.roundMoney(newCost, newCurrency),
      currency: newCurrency,
      price_per_unit: MoneyUtil.divide(newCost, newQuantity, newCurrency),
      fill_type: dto.fill_type ?? original.fill_type,
      tank_level_before: original.tank_level_before,
      tank_level_after: original.tank_level_after,
      station_name: dto.station_name !== undefined ? dto.station_name : original.station_name,
      location_reference: original.location_reference,
      source_type: original.source_type,
      actor_id: actor.user_id,
      is_corrected: false,
      correction_of_id: original.id,
      notes: `${dto.notes ?? original.notes ?? ''} [Corrected: ${dto.correction_reason.trim()}]`.trim(),
      created_at: now,
      updated_at: now,
    };

    this.repo.createFuelEntry(replacement);

    // Update the linked fuel expense if exists
    const existingExpenses = this.repo.getExpensesForVehicle(original.vehicle_id);
    const linkedExpense = existingExpenses.find(
      (e) => e.source_reference_type === 'FUEL_ENTRY' && e.source_reference_id === original.id
    );
    if (linkedExpense) {
      this.repo.updateExpense(linkedExpense.id, {
        amount: replacement.total_cost,
        currency: replacement.currency,
        occurred_at: replacement.fueled_at,
        source_reference_id: replacement.id,
        odometer_km: replacement.odometer_km,
        description: `Fuel purchase - ${replacement.quantity_litres}L at ${replacement.station_name || 'Station'} (Corrected)`,
      });
    }

    // Recalculate intervals and snapshots
    const allEntries = this.repo.getFuelEntriesForVehicle(original.vehicle_id);
    const intervals = FuelEconomyEngine.calculateIntervals(allEntries);
    this.repo.saveIntervals(original.vehicle_id, intervals);

    const snapshot = FuelAnomalyEngine.evaluateEfficiency(original.vehicle_id, intervals);
    this.repo.saveSnapshot(snapshot);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'FUEL_ENTRY_CORRECTED',
      resource_type: 'fuel_entry',
      resource_id: replacementId,
      correlation_id: `fuel_corr_${replacementId}`,
      source: 'finance-domain',
      metadata: {
        original_id: original.id,
        reason: dto.correction_reason,
      },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'fuel.entry_corrected',
      producer: 'finance-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: original.vehicle_id },
      correlation_id: `fuel_corr_${replacementId}`,
      payload: {
        original_entry_id: original.id,
        replacement_entry_id: replacementId,
        reason: dto.correction_reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return { entry: replacement, intervals };
  }

  /**
   * Retrieves fuel entries for a vehicle.
   */
  getFuelEntries(actor: AuthenticatedActorContext, vehicleId: string): FuelEntry[] {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_FUEL_READ);
    return this.repo.getFuelEntriesForVehicle(vehicleId);
  }

  /**
   * Retrieves a single fuel entry by ID.
   */
  getFuelEntryById(actor: AuthenticatedActorContext, fuelEntryId: string): FuelEntry {
    const entry = this.repo.getFuelEntryById(fuelEntryId);
    if (!entry) {
      throw new CanonicalAppError(
        ErrorCode.FUEL_ENTRY_NOT_FOUND,
        `Fuel entry ${fuelEntryId} not found`,
        404
      );
    }
    vehiclePolicy.assertVehicleAccess(actor, entry.vehicle_id, CanonicalPermission.VEHICLE_FUEL_READ);
    return entry;
  }

  /**
   * Retrieves fuel economy intervals for a vehicle.
   */
  getFuelEconomyIntervals(
    actor: AuthenticatedActorContext,
    vehicleId: string
  ): FuelEconomyInterval[] {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_FUEL_READ);
    return this.repo.getIntervalsForVehicle(vehicleId);
  }

  /**
   * Generates a fuel summary including consumption, average spend, and efficiency metrics.
   */
  getFuelSummary(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    period = 'ALL_TIME',
    from?: string,
    to?: string
  ): FuelSummaryDto {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_FUEL_READ);

    const bounds = TcoEngine.getPeriodBounds(period, from, to);
    const fromTime = bounds.from.getTime();
    const toTime = bounds.to.getTime();

    const allEntries = this.repo.getFuelEntriesForVehicle(vehicleId).filter((e) => !e.is_corrected);
    const inPeriodEntries = allEntries.filter((e) => {
      const t = new Date(e.fueled_at).getTime();
      return t >= fromTime && t <= toTime;
    });

    const intervals = this.repo.getIntervalsForVehicle(vehicleId);
    const latestSnapshot = this.repo.getLatestSnapshotForVehicle(vehicleId);

    // Group by currency
    const byCurrency: Record<string, { totalSpend: number; averagePricePerLitre: number | null }> = {};
    let totalQuantityLitres = 0;

    for (const e of inPeriodEntries) {
      const cur = MoneyUtil.normalizeCurrency(e.currency);
      totalQuantityLitres += e.quantity_litres;
      const curData = byCurrency[cur] ?? { totalSpend: 0, averagePricePerLitre: null };
      curData.totalSpend = MoneyUtil.roundMoney(curData.totalSpend + e.total_cost, cur);
      byCurrency[cur] = curData;
    }

    for (const cur of Object.keys(byCurrency)) {
      const entriesForCur = inPeriodEntries.filter((e) => e.currency === cur);
      const litForCur = entriesForCur.reduce((acc, e) => acc + e.quantity_litres, 0);
      byCurrency[cur].averagePricePerLitre =
        litForCur > 0 ? MoneyUtil.divide(byCurrency[cur].totalSpend, litForCur, cur) : null;
    }

    const currencies = Object.keys(byCurrency);
    const primaryCurrency = currencies[0] || 'KES';
    const primarySpend = byCurrency[primaryCurrency]?.totalSpend || 0;
    const avgPricePerLitre = byCurrency[primaryCurrency]?.averagePricePerLitre || null;

    // Distance covered in period
    let distanceCoveredKm: number | null = null;
    const odosInPeriod = inPeriodEntries
      .filter((e) => typeof e.odometer_km === 'number' && e.odometer_km > 0)
      .sort((a, b) => a.odometer_km! - b.odometer_km!);

    if (odosInPeriod.length >= 2) {
      const delta =
        odosInPeriod[odosInPeriod.length - 1].odometer_km! - odosInPeriod[0].odometer_km!;
      if (delta > 0) {
        distanceCoveredKm = Math.round(delta * 100) / 100;
      }
    }

    // Fuel economy metrics
    const inPeriodIntervals = intervals.filter((i) => {
      const t = new Date(i.calculated_at).getTime();
      return t >= fromTime && t <= toTime;
    });

    let avgEconomyKmPerLitre: number | null = null;
    let fuelEconomyStatus = FuelEconomyConfidence.INSUFFICIENT_DATA;
    let costPerKm: number | null = null;

    if (inPeriodIntervals.length > 0) {
      const totalIntervalDistance = inPeriodIntervals.reduce((acc, i) => acc + i.distance_km, 0);
      const totalIntervalFuel = inPeriodIntervals.reduce(
        (acc, i) => acc + i.fuel_consumed_litres,
        0
      );

      if (totalIntervalFuel > 0) {
        avgEconomyKmPerLitre =
          Math.round((totalIntervalDistance / totalIntervalFuel) * 100) / 100;
        fuelEconomyStatus = inPeriodIntervals[inPeriodIntervals.length - 1].confidence;
      }
    }

    if (distanceCoveredKm && distanceCoveredKm > 0 && primarySpend > 0) {
      costPerKm = Math.round((primarySpend / distanceCoveredKm) * 100) / 100;
    }

    const latestInterval = intervals.length > 0 ? intervals[intervals.length - 1] : null;

    return {
      vehicleId,
      period,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      currency: primaryCurrency,
      totalSpend: primarySpend,
      totalEntriesCount: inPeriodEntries.length,
      totalQuantityLitres: Math.round(totalQuantityLitres * 100) / 100,
      averagePricePerLitre: avgPricePerLitre,
      distanceCoveredKm,
      averageFuelEconomyKmPerLitre: avgEconomyKmPerLitre,
      costPerKm,
      fuelEconomyStatus,
      fuelEconomyDetails: avgEconomyKmPerLitre
        ? {
            kmPerLitre: avgEconomyKmPerLitre,
            litresPer100Km: FuelEconomyEngine.kmPerLitreToLitresPer100Km(avgEconomyKmPerLitre),
            mpgUs: FuelEconomyEngine.kmPerLitreToMpgUs(avgEconomyKmPerLitre),
            mpgUk: FuelEconomyEngine.kmPerLitreToMpgUk(avgEconomyKmPerLitre),
            qualifyingIntervalsCount: inPeriodIntervals.length,
          }
        : undefined,
      byCurrency,
      latestEconomy: latestInterval
        ? {
            kmPerLitre: latestInterval.km_per_litre,
            confidence: latestInterval.confidence,
            calculatedAt: latestInterval.calculated_at,
          }
        : null,
      anomalyObservation: latestSnapshot
        ? {
            detected: latestSnapshot.anomaly_detected,
            text: latestSnapshot.observation_text || 'Fuel efficiency is operating within normal baseline variance.',
            rollingEconomy: latestSnapshot.rolling_economy_km_l,
            baselineEconomy: latestSnapshot.baseline_economy_km_l,
            deltaPercent: latestSnapshot.delta_percent,
            observedAt: latestSnapshot.observed_at,
          }
        : null,
    };
  }

  // ==================== EXPENSE DOMAIN ====================

  /**
   * Records a general vehicle expense.
   */
  async recordExpense(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: RecordVehicleExpenseDTO
  ): Promise<VehicleExpense> {
    vehiclePolicy.assertVehicleAccess(
      actor,
      vehicleId,
      CanonicalPermission.VEHICLE_EXPENSE_RECORD
    );

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        `Vehicle ${vehicleId} not found`,
        404
      );
    }

    if (typeof dto.amount !== 'number' || dto.amount <= 0 || isNaN(dto.amount)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_AMOUNT,
        'Expense amount must be a strictly positive number',
        400
      );
    }

    if (!dto.description || dto.description.trim().length === 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Expense description is mandatory',
        400
      );
    }

    const currency = MoneyUtil.normalizeCurrency(dto.currency || 'KES');
    const category = dto.expense_category || ExpenseCategory.OTHER;
    const costType = dto.cost_type || CostType.ACTUAL;
    const status = dto.status || ExpenseStatus.CONFIRMED;
    const sourceType = dto.source_type || ExpenseSourceType.OWNER_ENTERED;
    const occurredAt = dto.occurred_at || getCurrentUtcIsoString();
    const recordedAt = getCurrentUtcIsoString();
    const expenseId = generateCanonicalId('vexp');

    const expense: VehicleExpense = {
      id: expenseId,
      vehicle_id: vehicleId,
      expense_category: category,
      expense_subcategory: dto.expense_subcategory ? dto.expense_subcategory.trim() : null,
      occurred_at: occurredAt,
      recorded_at: recordedAt,
      amount: MoneyUtil.roundMoney(dto.amount, currency),
      currency,
      cost_type: costType,
      status,
      description: dto.description.trim(),
      source_type: sourceType,
      source_reference_type: dto.source_reference_type ?? null,
      source_reference_id: dto.source_reference_id ?? null,
      merchant_provider_id: dto.merchant_provider_id ?? null,
      recurring_expense_id: dto.recurring_expense_id ?? null,
      odometer_km: dto.odometer_km ?? null,
      receipt_document_id: dto.receipt_document_id ?? null,
      notes: dto.notes ? dto.notes.trim() : null,
      is_corrected: false,
      correction_of_id: null,
      created_by: actor.user_id,
      created_at: recordedAt,
      updated_at: recordedAt,
    };

    this.repo.createExpense(expense);
    metrics.recordVehicleExpense(category);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_EXPENSE_RECORDED',
      resource_type: 'vehicle_expense',
      resource_id: expenseId,
      correlation_id: `vexp_rec_${expenseId}`,
      source: 'finance-domain',
      metadata: {
        vehicle_id: vehicleId,
        category,
        amount: expense.amount,
        currency,
        cost_type: costType,
      },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.expense.recorded',
      producer: 'finance-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `vexp_rec_${expenseId}`,
      payload: { expense },
    });
    enqueueOutboxEvent(eventEnvelope);

    return expense;
  }

  /**
   * Corrects an existing expense with audit trail tracking.
   */
  async correctExpense(
    actor: AuthenticatedActorContext,
    expenseId: string,
    dto: CorrectVehicleExpenseDTO
  ): Promise<VehicleExpense> {
    const original = this.repo.getExpenseById(expenseId);
    if (!original) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_NOT_FOUND,
        `Expense ${expenseId} not found`,
        404
      );
    }

    vehiclePolicy.assertVehicleAccess(
      actor,
      original.vehicle_id,
      CanonicalPermission.VEHICLE_EXPENSE_CORRECT
    );

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Correction reason is mandatory',
        400
      );
    }

    const newAmount = dto.amount !== undefined ? dto.amount : original.amount;
    if (typeof newAmount !== 'number' || newAmount <= 0 || isNaN(newAmount)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_AMOUNT,
        'Corrected expense amount must be strictly positive',
        400
      );
    }

    const newCurrency = MoneyUtil.normalizeCurrency(dto.currency ?? original.currency);
    const newCategory = dto.expense_category ?? original.expense_category;
    const now = getCurrentUtcIsoString();

    // Create correction audit record
    const correction: VehicleExpenseCorrection = {
      id: generateCanonicalId('vcorr'),
      vehicle_expense_id: original.id,
      vehicle_id: original.vehicle_id,
      previous_amount: original.amount,
      new_amount: MoneyUtil.roundMoney(newAmount, newCurrency),
      previous_currency: original.currency,
      new_currency: newCurrency,
      previous_category: original.expense_category,
      new_category: newCategory,
      reason: dto.reason.trim(),
      corrected_by: actor.user_id,
      corrected_at: now,
    };
    this.repo.createExpenseCorrection(correction);

    // Update expense record
    const updated = this.repo.updateExpense(original.id, {
      amount: correction.new_amount,
      currency: newCurrency,
      expense_category: newCategory,
      description: dto.description ?? original.description,
      occurred_at: dto.occurred_at ?? original.occurred_at,
    });

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_EXPENSE_CORRECTED',
      resource_type: 'vehicle_expense',
      resource_id: original.id,
      correlation_id: `vexp_corr_${original.id}`,
      source: 'finance-domain',
      metadata: {
        previous_amount: original.amount,
        new_amount: correction.new_amount,
        reason: dto.reason,
      },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.expense.corrected',
      producer: 'finance-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: original.vehicle_id },
      correlation_id: `vexp_corr_${original.id}`,
      payload: {
        expense_id: original.id,
        correction,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return updated;
  }

  /**
   * Retrieves vehicle expenses with optional category and period filters.
   */
  getExpenses(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    filters?: {
      category?: ExpenseCategory;
      costType?: CostType;
      from?: string;
      to?: string;
    }
  ): VehicleExpense[] {
    vehiclePolicy.assertVehicleAccess(
      actor,
      vehicleId,
      CanonicalPermission.VEHICLE_EXPENSE_READ
    );
    return this.repo.getExpensesForVehicle(vehicleId, filters);
  }

  /**
   * Retrieves single expense by ID.
   */
  getExpenseById(actor: AuthenticatedActorContext, expenseId: string): VehicleExpense {
    const exp = this.repo.getExpenseById(expenseId);
    if (!exp) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_NOT_FOUND,
        `Expense ${expenseId} not found`,
        404
      );
    }
    vehiclePolicy.assertVehicleAccess(
      actor,
      exp.vehicle_id,
      CanonicalPermission.VEHICLE_EXPENSE_READ
    );
    return exp;
  }

  // ==================== RECURRING EXPENSES ====================

  /**
   * Registers a recurring expense definition (insurance, inspection, parking, etc.).
   */
  createRecurringExpense(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: CreateRecurringExpenseDTO
  ): RecurringVehicleExpense {
    vehiclePolicy.assertVehicleAccess(
      actor,
      vehicleId,
      CanonicalPermission.VEHICLE_EXPENSE_MANAGE_RECURRING
    );

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        `Vehicle ${vehicleId} not found`,
        404
      );
    }

    if (typeof dto.amount !== 'number' || dto.amount <= 0 || isNaN(dto.amount)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_AMOUNT,
        'Recurring amount must be strictly positive',
        400
      );
    }

    const currency = MoneyUtil.normalizeCurrency(dto.currency || 'KES');
    const id = generateCanonicalId('vrec');
    const now = getCurrentUtcIsoString();
    const nextDue = this.calculateNextDueDate(dto.start_date, dto.frequency);

    const rec: RecurringVehicleExpense = {
      id,
      vehicle_id: vehicleId,
      category: dto.category,
      description: dto.description.trim(),
      amount: MoneyUtil.roundMoney(dto.amount, currency),
      currency,
      frequency: dto.frequency,
      start_date: dto.start_date,
      end_date: dto.end_date ?? null,
      next_due_date: nextDue,
      status: RecurringStatus.ACTIVE,
      auto_create_expense: Boolean(dto.auto_create_expense),
      last_processed_at: null,
      created_at: now,
      updated_at: now,
    };

    this.repo.createRecurringExpense(rec);

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'recurring_expense.created',
      producer: 'finance-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `rec_create_${id}`,
      payload: { recurring_expense: rec },
    });
    enqueueOutboxEvent(eventEnvelope);

    return rec;
  }

  /**
   * Updates recurring expense definition.
   */
  updateRecurringExpense(
    actor: AuthenticatedActorContext,
    recurringExpenseId: string,
    updates: Partial<RecurringVehicleExpense>
  ): RecurringVehicleExpense {
    const current = this.repo.getRecurringExpenseById(recurringExpenseId);
    if (!current) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_NOT_FOUND,
        `Recurring expense ${recurringExpenseId} not found`,
        404
      );
    }

    vehiclePolicy.assertVehicleAccess(
      actor,
      current.vehicle_id,
      CanonicalPermission.VEHICLE_EXPENSE_MANAGE_RECURRING
    );

    return this.repo.updateRecurringExpense(recurringExpenseId, updates);
  }

  /**
   * Retrieves all recurring expense definitions for a vehicle.
   */
  getRecurringExpenses(
    actor: AuthenticatedActorContext,
    vehicleId: string
  ): RecurringVehicleExpense[] {
    vehiclePolicy.assertVehicleAccess(
      actor,
      vehicleId,
      CanonicalPermission.VEHICLE_EXPENSE_READ
    );
    return this.repo.getRecurringExpensesForVehicle(vehicleId);
  }

  /**
   * Processes due recurring expenses and schedules next occurrences (Background Job).
   */
  processDueRecurringExpenses(asOfUtc = getCurrentUtcIsoString()): {
    processedCount: number;
    eventsEmitted: number;
  } {
    const dueList = this.repo.getDueRecurringExpenses(asOfUtc);
    let processedCount = 0;
    let eventsEmitted = 0;

    for (const rec of dueList) {
      const nextDue = this.calculateNextDueDate(rec.next_due_date, rec.frequency);
      const isExpired = rec.end_date && new Date(nextDue) > new Date(rec.end_date);

      this.repo.updateRecurringExpense(rec.id, {
        last_processed_at: asOfUtc,
        next_due_date: nextDue,
        status: isExpired ? RecurringStatus.EXPIRED : rec.status,
      });

      if (rec.auto_create_expense) {
        const expenseId = generateCanonicalId('exp');
        this.repo.createExpense({
          id: expenseId,
          vehicle_id: rec.vehicle_id,
          expense_category: rec.category,
          expense_subcategory: 'RECURRING',
          occurred_at: rec.next_due_date,
          recorded_at: asOfUtc,
          amount: rec.amount,
          currency: rec.currency,
          cost_type: CostType.ACTUAL,
          status: ExpenseStatus.CONFIRMED,
          description: rec.description,
          source_type: ExpenseSourceType.SYSTEM_DERIVED,
          source_reference_type: 'RECURRING_EXPENSE',
          source_reference_id: rec.id,
          merchant_provider_id: null,
          recurring_expense_id: rec.id,
          odometer_km: null,
          receipt_document_id: null,
          notes: `Auto-generated recurring expense for period due ${rec.next_due_date}`,
          is_corrected: false,
          correction_of_id: null,
          created_by: 'SYSTEM',
          created_at: asOfUtc,
          updated_at: asOfUtc,
        });
        metrics.recordVehicleExpense(rec.category);
      }

      // Emit RecurringExpenseDue event (GAR-009 §70)
      const eventEnvelope = createCanonicalEventEnvelope({
        type: 'recurring_expense.due',
        producer: 'finance-domain',
        actor_id: 'SYSTEM',
        actor_type: CanonicalActorType.SYSTEM_WORKER,
        subject_ids: { vehicle: rec.vehicle_id },
        correlation_id: `rec_due_${rec.id}_${asOfUtc}`,
        payload: {
          recurring_expense_id: rec.id,
          amount: rec.amount,
          currency: rec.currency,
          category: rec.category,
          due_date: rec.next_due_date,
        },
      });
      enqueueOutboxEvent(eventEnvelope);

      metrics.recordRecurringExpenseProcessed();
      processedCount++;
      eventsEmitted++;
    }

    return { processedCount, eventsEmitted };
  }

  // ==================== TOTAL COST OF OWNERSHIP (TCO) ====================

  /**
   * Calculates Total Cost of Ownership summary with multi-currency separation.
   */
  getTcoSummary(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    period = 'ALL_TIME',
    from?: string,
    to?: string
  ): TotalCostOfOwnershipSummary {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TCO_READ);

    const expenses = this.repo.getExpensesForVehicle(vehicleId);
    const recurring = this.repo.getRecurringExpensesForVehicle(vehicleId);

    // Fetch vehicle odometer observations to determine distance
    const odometers = vehicleRepository.listOdometerObservations(vehicleId, 500);
    const validOdos = odometers
      .filter((o) => o.status === 'VALID' && o.reading_km !== null)
      .map((o) => ({ km: o.reading_km!, recorded_at: o.observed_at }));

    const tco = TcoEngine.calculateTco(
      vehicleId,
      expenses,
      recurring,
      period,
      from,
      to,
      validOdos
    );

    metrics.recordTcoSummaryGenerated();
    return tco;
  }

  // ==================== HELPER METHODS ====================

  private calculateNextDueDate(currentDateStr: string, frequency: RecurringFrequency): string {
    const d = new Date(currentDateStr);
    switch (frequency) {
      case RecurringFrequency.WEEKLY:
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case RecurringFrequency.MONTHLY:
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case RecurringFrequency.QUARTERLY:
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case RecurringFrequency.SEMI_ANNUAL:
        d.setUTCMonth(d.getUTCMonth() + 6);
        break;
      case RecurringFrequency.ANNUAL:
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
      case RecurringFrequency.CUSTOM:
      default:
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
    }
    return d.toISOString();
  }

  private assertFuelTypeCompatibility(vehicleFuelType: string, entryFuelType: string): void {
    const vType = vehicleFuelType.toUpperCase();
    const eType = entryFuelType.toUpperCase();

    // Electric vehicle validation
    if (vType === FuelType.ELECTRIC && (eType === 'PETROL' || eType === 'DIESEL')) {
      throw new CanonicalAppError(
        ErrorCode.FUEL_INCOMPATIBLE_TYPE,
        `Cannot record fossil fuel ${eType} for pure Electric Vehicle`,
        422
      );
    }

    // Petrol vs Diesel mismatch
    if (vType === FuelType.DIESEL && eType === 'PETROL') {
      throw new CanonicalAppError(
        ErrorCode.FUEL_INCOMPATIBLE_TYPE,
        'Cannot record Petrol fuel for a Diesel vehicle engine',
        422
      );
    }

    if (vType === FuelType.PETROL && eType === 'DIESEL') {
      throw new CanonicalAppError(
        ErrorCode.FUEL_INCOMPATIBLE_TYPE,
        'Cannot record Diesel fuel for a Petrol vehicle engine',
        422
      );
    }
  }
}

export const fuelExpenseService = new FuelExpenseService();
