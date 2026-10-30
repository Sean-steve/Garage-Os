import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { fuelExpenseService } from '../../src/server/finance/fuelExpenseService';
import {
  CostType,
  ExpenseCategory,
  FillType,
  FuelQuantityUnit,
  RecurringFrequency,
} from '../../src/server/finance/types';
import { AuthenticatedActorContext } from '../../src/server/identity/types';
import { FuelType, OdometerUnit } from '../../src/server/vehicle/types';

describe('Fuel, Expense & Total Cost of Ownership Architecture (GAR-009)', () => {
  let vehicleId: string;
  let ownerActor: AuthenticatedActorContext;

  beforeEach(() => {
    resetDatabaseInstance();
    const db = getDatabase({ memory: true });
    runMigrations(db);

    // Register test owner
    const reg = authService.registerUser({
      email: 'jane@garageos.test',
      fullName: 'Jane Wambui',
      password: 'SecurePassword123!',
    });
    ownerActor = authService.getActorContextById(reg.user.id)!;

    // Create test vehicle via canonical vehicle service
    const veh = vehicleService.createVehicle(ownerActor, {
      vin: 'JTEBH51J005123999',
      registration_number: 'KDA 789X',
      make: 'Toyota',
      model: 'Prado',
      model_year: 2020,
      fuel_type: FuelType.DIESEL,
      initial_odometer_value: 50000,
      initial_odometer_unit: OdometerUnit.KM,
    });
    vehicleId = veh.vehicle.id;
  });

  it('records initial fuel purchase and auto-creates system-derived expense', async () => {
    const result = await fuelExpenseService.recordFuelEntry(ownerActor, vehicleId, {
      fueled_at: '2026-01-01T08:00:00Z',
      odometer_value: 50000,
      odometer_unit: 'KM',
      fuel_type: 'DIESEL',
      quantity: 70,
      quantity_unit: FuelQuantityUnit.LITRE,
      total_cost: 12600,
      currency: 'KES',
      fill_type: FillType.FULL,
      station_name: 'TotalEnergies Hurlingham',
      notes: 'Initial full tank',
    });

    assert.ok(result.entry.id);
    assert.equal(result.entry.quantity_litres, 70);
    assert.equal(result.entry.price_per_unit, 180);
    assert.equal(result.intervals.length, 0); // No prior full fill to form an interval

    // Verify auto-created expense
    const expenses = fuelExpenseService.getExpenses(ownerActor, vehicleId, { category: ExpenseCategory.FUEL });
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].amount, 12600);
    assert.equal(expenses[0].source_type, 'SYSTEM_DERIVED');
    assert.equal(expenses[0].source_reference_id, result.entry.id);
  });

  it('calculates full-to-full fuel economy upon second consecutive full fill', async () => {
    // Fill 1
    await fuelExpenseService.recordFuelEntry(ownerActor, vehicleId, {
      fueled_at: '2026-01-01T08:00:00Z',
      odometer_value: 50000,
      odometer_unit: 'KM',
      fuel_type: 'DIESEL',
      quantity: 70,
      quantity_unit: FuelQuantityUnit.LITRE,
      total_cost: 12600,
      currency: 'KES',
      fill_type: FillType.FULL,
      station_name: 'TotalEnergies Hurlingham',
    });

    // Fill 2: 750 km later, 68 litres
    const result2 = await fuelExpenseService.recordFuelEntry(ownerActor, vehicleId, {
      fueled_at: '2026-01-12T09:00:00Z',
      odometer_value: 50750,
      odometer_unit: 'KM',
      fuel_type: 'DIESEL',
      quantity: 68,
      quantity_unit: FuelQuantityUnit.LITRE,
      total_cost: 12240,
      currency: 'KES',
      fill_type: FillType.FULL,
      station_name: 'Rubis Westlands',
    });

    assert.equal(result2.intervals.length, 1);
    const intervals = fuelExpenseService.getFuelEconomyIntervals(ownerActor, vehicleId);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].distance_km, 750);
    assert.equal(intervals[0].fuel_consumed_litres, 68);
    // 750 / 68 = 11.03 km/L
    assert.ok(Math.abs(intervals[0].km_per_litre - 11.03) < 0.05);

    // Summary check
    const summary = fuelExpenseService.getFuelSummary(ownerActor, vehicleId, 'ALL_TIME');
    assert.equal(summary.totalEntriesCount, 2);
    assert.equal(summary.totalQuantityLitres, 138);
    assert.equal(summary.byCurrency['KES'].totalSpend, 24840);
    assert.ok(summary.averageFuelEconomyKmPerLitre !== null && summary.averageFuelEconomyKmPerLitre > 11.0);
  });

  it('records vehicle expense and computes accurate Total Cost of Ownership', async () => {
    // Record Service Expense
    await fuelExpenseService.recordExpense(ownerActor, vehicleId, {
      expense_category: ExpenseCategory.MAINTENANCE,
      occurred_at: '2026-01-15T10:00:00Z',
      amount: 25000,
      currency: 'KES',
      cost_type: CostType.ACTUAL,
      description: 'Minor service 50k km',
    });

    // Record Annual Insurance Expense
    await fuelExpenseService.recordExpense(ownerActor, vehicleId, {
      expense_category: ExpenseCategory.INSURANCE,
      occurred_at: '2026-01-01T00:00:00Z',
      amount: 75000,
      currency: 'KES',
      cost_type: CostType.ACTUAL,
      description: 'Comprehensive Motor Insurance',
    });

    const tco = fuelExpenseService.getTcoSummary(ownerActor, vehicleId, 'ALL_TIME');
    assert.equal(tco.byCurrency['KES'].totalActual, 100000);
    assert.equal(tco.byCurrency['KES'].byCategory[ExpenseCategory.MAINTENANCE], 25000);
    assert.equal(tco.byCurrency['KES'].byCategory[ExpenseCategory.INSURANCE], 75000);
  });

  it('manages recurring expense schedules and evaluates due items', () => {
    const rec = fuelExpenseService.createRecurringExpense(ownerActor, vehicleId, {
      category: ExpenseCategory.PARKING,
      description: 'Monthly Parking Permit',
      amount: 5000,
      currency: 'KES',
      frequency: RecurringFrequency.MONTHLY,
      start_date: '2026-01-01T00:00:00Z',
      auto_create_expense: true,
    });

    assert.ok(rec.id);
    assert.equal(rec.status, 'ACTIVE');

    // Process due expenses as of 2026-02-05 (which is after next_due_date 2026-02-01)
    const runResult = fuelExpenseService.processDueRecurringExpenses('2026-02-05T00:00:00Z');
    assert.ok(runResult.processedCount >= 1);

    // Verify auto-created expense was recorded
    const expenses = fuelExpenseService.getExpenses(ownerActor, vehicleId, { category: ExpenseCategory.PARKING });
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].amount, 5000);
    assert.equal(expenses[0].recurring_expense_id, rec.id);
  });

  it('corrects fuel purchase with audit trail and updates derived expense', async () => {
    const initial = await fuelExpenseService.recordFuelEntry(ownerActor, vehicleId, {
      fueled_at: '2026-01-01T08:00:00Z',
      odometer_value: 50000,
      odometer_unit: 'KM',
      fuel_type: 'DIESEL',
      quantity: 70,
      quantity_unit: FuelQuantityUnit.LITRE,
      total_cost: 12600,
      currency: 'KES',
      fill_type: FillType.FULL,
    });

    // Correct typo in cost (was 12600, corrected to 12000)
    const corrected = await fuelExpenseService.correctFuelEntry(ownerActor, initial.entry.id, {
      total_cost: 12000,
      correction_reason: 'Typo in fuel receipt total cost',
    });

    assert.equal(corrected.entry.total_cost, 12000);
    assert.equal(corrected.entry.correction_of_id, initial.entry.id);

    // Verify original entry was marked corrected
    const originalEntry = fuelExpenseService.getFuelEntries(ownerActor, vehicleId).find((e) => e.id === initial.entry.id);
    assert.equal(originalEntry?.is_corrected, true);

    // Verify associated expense was also updated
    const expenses = fuelExpenseService.getExpenses(ownerActor, vehicleId, { category: ExpenseCategory.FUEL });
    assert.equal(expenses[0].amount, 12000);
  });
});
