import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MoneyUtil } from '../../src/server/finance/money';
import { FuelEconomyEngine } from '../../src/server/finance/fuelEconomy';
import { FuelAnomalyEngine } from '../../src/server/finance/anomalyEngine';
import { TcoEngine } from '../../src/server/finance/tcoEngine';
import {
  CostType,
  ExpenseCategory,
  ExpenseSourceType,
  ExpenseStatus,
  FillType,
  FuelEconomyConfidence,
  FuelQuantityUnit,
  FuelSourceType,
  FuelEntry,
  VehicleExpense,
} from '../../src/server/finance/types';

describe('Decimal-Safe Money Engine (GAR-009 §4)', () => {
  it('creates money in exact minor units without floating-point drift', () => {
    const minorUnits = MoneyUtil.toMinorUnits(1250.75, 'KES');
    assert.equal(minorUnits, 125075n);
    assert.equal(MoneyUtil.fromMinorUnits(minorUnits, 'KES'), 1250.75);
    assert.equal(MoneyUtil.format(1250.75, 'KES'), 'KES 1,250.75');
  });

  it('performs exact addition and summation', () => {
    const sumResult = MoneyUtil.add(10.10, 'USD', 20.20, 'USD');
    assert.equal(sumResult.amount, 30.30);
    assert.equal(sumResult.currency, 'USD');

    const totalSum = MoneyUtil.sum([10.10, 20.20, 5.00], 'USD');
    assert.equal(totalSum, 35.30);
  });

  it('rejects adding money with mismatched currencies without exchange rate source', () => {
    assert.throws(
      () => MoneyUtil.add(1000, 'KES', 10, 'USD'),
      /Cannot combine mismatched currencies/
    );
  });

  it('calculates unit price accurately via divide', () => {
    const unitPrice = MoneyUtil.divide(12600, 70, 'KES');
    assert.equal(unitPrice, 180);
  });
});

describe('Fuel Economy Engine (GAR-009 §3)', () => {
  it('correctly converts fuel volume units', () => {
    assert.equal(FuelEconomyEngine.normalizeToLitres(10, FuelQuantityUnit.LITRE), 10);
    const usGal = FuelEconomyEngine.normalizeToLitres(1, FuelQuantityUnit.GALLON_US);
    assert.ok(Math.abs(usGal - 3.7854) < 0.001);
    const ukGal = FuelEconomyEngine.normalizeToLitres(1, FuelQuantityUnit.GALLON_UK);
    assert.ok(Math.abs(ukGal - 4.5461) < 0.001);
  });

  it('computes fuel economy metric conversions', () => {
    const kmL = 12.0;
    const l100 = FuelEconomyEngine.kmPerLitreToLitresPer100Km(kmL);
    assert.equal(l100, 8.33);

    const mpgUs = FuelEconomyEngine.kmPerLitreToMpgUs(kmL);
    assert.ok(Math.abs(mpgUs - 28.23) < 0.05);

    const mpgUk = FuelEconomyEngine.kmPerLitreToMpgUk(kmL);
    assert.ok(Math.abs(mpgUk - 33.9) < 0.05);
  });

  it('produces empty intervals when no previous full tank exists', () => {
    const entry: FuelEntry = {
      id: 'fuel_1',
      vehicle_id: 'veh_1',
      fueled_at: '2026-01-01T00:00:00Z',
      recorded_at: '2026-01-01T00:00:00Z',
      odometer_value: 50000,
      odometer_unit: 'KM',
      odometer_km: 50000,
      fuel_type: 'PETROL',
      quantity: 50,
      quantity_unit: FuelQuantityUnit.LITRE,
      quantity_litres: 50,
      total_cost: 9000,
      currency: 'KES',
      price_per_unit: 180,
      fill_type: FillType.FULL,
      tank_level_before: null,
      tank_level_after: 1,
      station_name: null,
      location_reference: null,
      source_type: FuelSourceType.OWNER_ENTERED,
      actor_id: 'usr_1',
      is_corrected: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const intervals = FuelEconomyEngine.calculateIntervals([entry]);
    assert.equal(intervals.length, 0);
  });

  it('calculates full-to-full interval across multiple chronological entries', () => {
    const entry1: FuelEntry = {
      id: 'fuel_1',
      vehicle_id: 'veh_1',
      fueled_at: '2026-01-01T00:00:00Z',
      recorded_at: '2026-01-01T00:00:00Z',
      odometer_value: 50000,
      odometer_unit: 'KM',
      odometer_km: 50000,
      fuel_type: 'DIESEL',
      quantity: 60,
      quantity_unit: FuelQuantityUnit.LITRE,
      quantity_litres: 60,
      total_cost: 10800,
      currency: 'KES',
      price_per_unit: 180,
      fill_type: FillType.FULL,
      tank_level_before: 0.2,
      tank_level_after: 1.0,
      station_name: 'Total',
      location_reference: null,
      source_type: FuelSourceType.OWNER_ENTERED,
      actor_id: 'usr_1',
      is_corrected: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const entry2: FuelEntry = {
      id: 'fuel_2',
      vehicle_id: 'veh_1',
      fueled_at: '2026-01-10T00:00:00Z',
      recorded_at: '2026-01-10T00:00:00Z',
      odometer_value: 50600,
      odometer_unit: 'KM',
      odometer_km: 50600,
      fuel_type: 'DIESEL',
      quantity: 50,
      quantity_unit: FuelQuantityUnit.LITRE,
      quantity_litres: 50,
      total_cost: 9000,
      currency: 'KES',
      price_per_unit: 180,
      fill_type: FillType.FULL,
      tank_level_before: 0.2,
      tank_level_after: 1.0,
      station_name: 'Shell',
      location_reference: null,
      source_type: FuelSourceType.OWNER_ENTERED,
      actor_id: 'usr_1',
      is_corrected: false,
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    };

    const intervals = FuelEconomyEngine.calculateIntervals([entry1, entry2]);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].distance_km, 600);
    assert.equal(intervals[0].fuel_consumed_litres, 50);
    assert.equal(intervals[0].km_per_litre, 12);
    assert.equal(intervals[0].litres_per_100_km, 8.33);
  });
});

describe('Fuel Anomaly Engine (GAR-009 §3.3)', () => {
  it('requires minimum 3 qualifying intervals for baseline detection', () => {
    const intervals = [
      {
        id: 'i1',
        vehicle_id: 'veh_1',
        start_fuel_entry_id: 'f1',
        end_fuel_entry_id: 'f2',
        distance_km: 500,
        fuel_consumed_litres: 50,
        km_per_litre: 10,
        litres_per_100_km: 10,
        mpg_us: 23.52,
        mpg_uk: 28.25,
        confidence: FuelEconomyConfidence.HIGH,
        partial_fills_included_count: 0,
        calculated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const snapshot = FuelAnomalyEngine.evaluateEfficiency('veh_1', intervals);
    assert.equal(snapshot.data_quality, 'INSUFFICIENT_DATA');
    assert.equal(snapshot.anomaly_detected, false);
    assert.equal(snapshot.qualifying_intervals_count, 1);
  });

  it('detects efficiency degradation exceeding 15% threshold', () => {
    const makeInterval = (id: string, kmL: number, day: number) => ({
      id,
      vehicle_id: 'veh_1',
      start_fuel_entry_id: `s_${id}`,
      end_fuel_entry_id: `e_${id}`,
      distance_km: 600,
      fuel_consumed_litres: 600 / kmL,
      km_per_litre: kmL,
      litres_per_100_km: 100 / kmL,
      mpg_us: 25,
      mpg_uk: 30,
      confidence: FuelEconomyConfidence.HIGH,
      partial_fills_included_count: 0,
      calculated_at: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`,
    });

    const intervals = [
      makeInterval('i1', 12.0, 1),
      makeInterval('i2', 12.2, 5),
      makeInterval('i3', 11.9, 10),
      makeInterval('i4', 12.1, 15),
      makeInterval('i5', 9.2, 20),
      makeInterval('i6', 9.1, 25),
    ];

    const snapshot = FuelAnomalyEngine.evaluateEfficiency('veh_1', intervals);
    assert.equal(snapshot.anomaly_detected, true);
    assert.ok(snapshot.delta_percent !== null && snapshot.delta_percent < -15);
    assert.ok(snapshot.observation_text?.includes('Fuel consumption has increased'));
  });
});

describe('Total Cost of Ownership Engine (GAR-009 §4)', () => {
  it('categorizes expenses with multi-currency separation and calculates cost per km', () => {
    const expenses: VehicleExpense[] = [
      {
        id: 'e1',
        vehicle_id: 'veh_1',
        expense_category: ExpenseCategory.FUEL,
        expense_subcategory: 'FILL',
        occurred_at: '2026-01-01T00:00:00Z',
        recorded_at: '2026-01-01T00:00:00Z',
        amount: 10000,
        currency: 'KES',
        cost_type: CostType.ACTUAL,
        status: ExpenseStatus.CONFIRMED,
        description: 'Fuel Fill',
        source_type: ExpenseSourceType.SYSTEM_DERIVED,
        source_reference_type: null,
        source_reference_id: null,
        merchant_provider_id: null,
        recurring_expense_id: null,
        odometer_km: 50000,
        receipt_document_id: null,
        notes: null,
        is_corrected: false,
        created_by: 'usr_1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'e2',
        vehicle_id: 'veh_1',
        expense_category: ExpenseCategory.INSURANCE,
        expense_subcategory: 'ANNUAL',
        occurred_at: '2026-01-01T00:00:00Z',
        recorded_at: '2026-01-01T00:00:00Z',
        amount: 80000,
        currency: 'KES',
        cost_type: CostType.ACTUAL,
        status: ExpenseStatus.CONFIRMED,
        description: 'Comprehensive Insurance',
        source_type: ExpenseSourceType.OWNER_ENTERED,
        source_reference_type: null,
        source_reference_id: null,
        merchant_provider_id: null,
        recurring_expense_id: null,
        odometer_km: 50000,
        receipt_document_id: null,
        notes: null,
        is_corrected: false,
        created_by: 'usr_1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const odometerReadings = [
      { km: 50000, recorded_at: '2026-01-01T00:00:00Z' },
      { km: 51000, recorded_at: '2026-01-31T00:00:00Z' },
    ];

    const tco = TcoEngine.calculateTco('veh_1', expenses, [], 'ALL_TIME', undefined, undefined, odometerReadings);
    assert.ok(tco.byCurrency['KES']);
    assert.equal(tco.byCurrency['KES'].totalActual, 90000);
    assert.equal(tco.byCurrency['KES'].byCategory[ExpenseCategory.FUEL], 10000);
    assert.equal(tco.byCurrency['KES'].byCategory[ExpenseCategory.INSURANCE], 80000);
    assert.equal(tco.byCurrency['KES'].distanceCoveredKm, 1000);
    assert.equal(tco.byCurrency['KES'].costPerKm, 90); // 90000 / 1000
    assert.equal(tco.byCurrency['KES'].costPerKmStatus, 'CALCULATED');
  });
});
