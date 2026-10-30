/**
 * Canonical Fuel & Expense Repository (GAR-009, GAR-033 §5, §15)
 *
 * Implements persistent SQLite storage for fuel entries, calculated economy intervals,
 * vehicle expenses, expense corrections, recurring expenses, and snapshots.
 */

import { getDatabase } from '../database/connection';
import {
  CostType,
  ExpenseCategory,
  ExpenseSourceType,
  ExpenseStatus,
  FillType,
  FuelEconomyConfidence,
  FuelEconomyInterval,
  FuelEfficiencySnapshot,
  FuelEntry,
  FuelQuantityUnit,
  FuelSourceType,
  RecurringFrequency,
  RecurringStatus,
  RecurringVehicleExpense,
  VehicleExpense,
  VehicleExpenseCorrection,
} from './types';

export class FuelExpenseRepository {
  // ==================== FUEL ENTRIES ====================

  createFuelEntry(entry: FuelEntry): FuelEntry {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO fuel_entries (
        id, vehicle_id, fueled_at, recorded_at, odometer_value, odometer_unit, odometer_km,
        fuel_type, quantity, quantity_unit, quantity_litres, total_cost, currency,
        price_per_unit, fill_type, tank_level_before, tank_level_after, station_name,
        location_reference, source_type, actor_id, is_corrected, correction_of_id,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      );
    `);

    stmt.run(
      entry.id,
      entry.vehicle_id,
      entry.fueled_at,
      entry.recorded_at,
      entry.odometer_value ?? null,
      entry.odometer_unit ?? null,
      entry.odometer_km ?? null,
      entry.fuel_type,
      entry.quantity,
      entry.quantity_unit,
      entry.quantity_litres,
      entry.total_cost,
      entry.currency,
      entry.price_per_unit ?? null,
      entry.fill_type,
      entry.tank_level_before ?? null,
      entry.tank_level_after ?? null,
      entry.station_name ?? null,
      entry.location_reference ?? null,
      entry.source_type,
      entry.actor_id,
      entry.is_corrected ? 1 : 0,
      entry.correction_of_id ?? null,
      entry.notes ?? null,
      entry.created_at,
      entry.updated_at
    );

    return entry;
  }

  getFuelEntryById(id: string): FuelEntry | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM fuel_entries WHERE id = ?;').get(id) as Record<string, any> | undefined;
    if (!row) return null;
    return this.mapRowToFuelEntry(row);
  }

  getFuelEntriesForVehicle(vehicleId: string): FuelEntry[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM fuel_entries WHERE vehicle_id = ? ORDER BY fueled_at ASC, odometer_km ASC;')
      .all(vehicleId) as Array<Record<string, any>>;
    return rows.map((r) => this.mapRowToFuelEntry(r));
  }

  markFuelEntryCorrected(id: string, correctionOfId?: string): void {
    const db = getDatabase();
    db.prepare("UPDATE fuel_entries SET is_corrected = 1, correction_of_id = ?, updated_at = datetime('now') WHERE id = ?;")
      .run(correctionOfId ?? null, id);
  }

  // ==================== FUEL ECONOMY INTERVALS ====================

  saveIntervals(vehicleId: string, intervals: FuelEconomyInterval[]): void {
    const db = getDatabase();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM fuel_economy_intervals WHERE vehicle_id = ?;').run(vehicleId);
      const insertStmt = db.prepare(`
        INSERT INTO fuel_economy_intervals (
          id, vehicle_id, start_fuel_entry_id, end_fuel_entry_id, distance_km,
          fuel_consumed_litres, km_per_litre, litres_per_100_km, mpg_us, mpg_uk,
          confidence, partial_fills_included_count, calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      for (const i of intervals) {
        insertStmt.run(
          i.id,
          i.vehicle_id,
          i.start_fuel_entry_id,
          i.end_fuel_entry_id,
          i.distance_km,
          i.fuel_consumed_litres,
          i.km_per_litre,
          i.litres_per_100_km,
          i.mpg_us,
          i.mpg_uk,
          i.confidence,
          i.partial_fills_included_count,
          i.calculated_at
        );
      }
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  }

  getIntervalsForVehicle(vehicleId: string): FuelEconomyInterval[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM fuel_economy_intervals WHERE vehicle_id = ? ORDER BY calculated_at ASC;')
      .all(vehicleId) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id,
      vehicle_id: r.vehicle_id,
      start_fuel_entry_id: r.start_fuel_entry_id,
      end_fuel_entry_id: r.end_fuel_entry_id,
      distance_km: r.distance_km,
      fuel_consumed_litres: r.fuel_consumed_litres,
      km_per_litre: r.km_per_litre,
      litres_per_100_km: r.litres_per_100_km,
      mpg_us: r.mpg_us,
      mpg_uk: r.mpg_uk,
      confidence: r.confidence as FuelEconomyConfidence,
      partial_fills_included_count: r.partial_fills_included_count,
      calculated_at: r.calculated_at,
    }));
  }

  // ==================== FUEL EFFICIENCY SNAPSHOTS ====================

  saveSnapshot(snapshot: FuelEfficiencySnapshot): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO fuel_efficiency_snapshots (
        id, vehicle_id, rolling_economy_km_l, baseline_economy_km_l, delta_percent,
        anomaly_detected, observation_text, data_quality, qualifying_intervals_count,
        total_distance_km, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      snapshot.id,
      snapshot.vehicle_id,
      snapshot.rolling_economy_km_l,
      snapshot.baseline_economy_km_l,
      snapshot.delta_percent,
      snapshot.anomaly_detected ? 1 : 0,
      snapshot.observation_text ?? null,
      snapshot.data_quality,
      snapshot.qualifying_intervals_count,
      snapshot.total_distance_km,
      snapshot.observed_at,
      snapshot.created_at
    );
  }

  getLatestSnapshotForVehicle(vehicleId: string): FuelEfficiencySnapshot | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM fuel_efficiency_snapshots WHERE vehicle_id = ? ORDER BY observed_at DESC LIMIT 1;')
      .get(vehicleId) as Record<string, any> | undefined;
    if (!row) return null;
    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      rolling_economy_km_l: row.rolling_economy_km_l,
      baseline_economy_km_l: row.baseline_economy_km_l,
      delta_percent: row.delta_percent,
      anomaly_detected: Boolean(row.anomaly_detected),
      observation_text: row.observation_text ?? null,
      data_quality: row.data_quality,
      qualifying_intervals_count: row.qualifying_intervals_count,
      total_distance_km: row.total_distance_km,
      observed_at: row.observed_at,
      created_at: row.created_at,
    };
  }

  // ==================== VEHICLE EXPENSES ====================

  createExpense(expense: VehicleExpense): VehicleExpense {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO vehicle_expenses (
        id, vehicle_id, expense_category, expense_subcategory, occurred_at, recorded_at,
        amount, currency, cost_type, status, description, source_type,
        source_reference_type, source_reference_id, merchant_provider_id,
        recurring_expense_id, odometer_km, receipt_document_id, notes,
        is_corrected, correction_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      );
    `);

    stmt.run(
      expense.id,
      expense.vehicle_id,
      expense.expense_category,
      expense.expense_subcategory ?? null,
      expense.occurred_at,
      expense.recorded_at,
      expense.amount,
      expense.currency,
      expense.cost_type,
      expense.status,
      expense.description,
      expense.source_type,
      expense.source_reference_type ?? null,
      expense.source_reference_id ?? null,
      expense.merchant_provider_id ?? null,
      expense.recurring_expense_id ?? null,
      expense.odometer_km ?? null,
      expense.receipt_document_id ?? null,
      expense.notes ?? null,
      expense.is_corrected ? 1 : 0,
      expense.correction_of_id ?? null,
      expense.created_by,
      expense.created_at,
      expense.updated_at
    );

    return expense;
  }

  getExpenseById(id: string): VehicleExpense | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_expenses WHERE id = ?;').get(id) as Record<string, any> | undefined;
    if (!row) return null;
    return this.mapRowToExpense(row);
  }

  getExpensesForVehicle(
    vehicleId: string,
    filters?: {
      category?: ExpenseCategory;
      costType?: CostType;
      from?: string;
      to?: string;
    }
  ): VehicleExpense[] {
    const db = getDatabase();
    let query = 'SELECT * FROM vehicle_expenses WHERE vehicle_id = ?';
    const params: any[] = [vehicleId];

    if (filters?.category) {
      query += ' AND expense_category = ?';
      params.push(filters.category);
    }
    if (filters?.costType) {
      query += ' AND cost_type = ?';
      params.push(filters.costType);
    }
    if (filters?.from) {
      query += ' AND occurred_at >= ?';
      params.push(filters.from);
    }
    if (filters?.to) {
      query += ' AND occurred_at <= ?';
      params.push(filters.to);
    }

    query += ' ORDER BY occurred_at DESC;';
    const rows = db.prepare(query).all(...params) as Array<Record<string, any>>;
    return rows.map((r) => this.mapRowToExpense(r));
  }

  updateExpense(id: string, updates: Partial<VehicleExpense>): VehicleExpense {
    const db = getDatabase();
    const current = this.getExpenseById(id);
    if (!current) {
      throw new Error(`Expense ${id} not found`);
    }

    const merged = { ...current, ...updates, updated_at: new Date().toISOString() };
    db.prepare(`
      UPDATE vehicle_expenses SET
        expense_category = ?, expense_subcategory = ?, occurred_at = ?, amount = ?,
        currency = ?, cost_type = ?, status = ?, description = ?, notes = ?,
        is_corrected = ?, correction_of_id = ?, updated_at = ?
      WHERE id = ?;
    `).run(
      merged.expense_category,
      merged.expense_subcategory ?? null,
      merged.occurred_at,
      merged.amount,
      merged.currency,
      merged.cost_type,
      merged.status,
      merged.description,
      merged.notes ?? null,
      merged.is_corrected ? 1 : 0,
      merged.correction_of_id ?? null,
      merged.updated_at,
      id
    );

    return merged;
  }

  // ==================== EXPENSE CORRECTIONS ====================

  createExpenseCorrection(correction: VehicleExpenseCorrection): VehicleExpenseCorrection {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_expense_corrections (
        id, vehicle_expense_id, vehicle_id, previous_amount, new_amount,
        previous_currency, new_currency, previous_category, new_category,
        reason, corrected_by, corrected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      correction.id,
      correction.vehicle_expense_id,
      correction.vehicle_id,
      correction.previous_amount,
      correction.new_amount,
      correction.previous_currency,
      correction.new_currency,
      correction.previous_category,
      correction.new_category,
      correction.reason,
      correction.corrected_by,
      correction.corrected_at
    );
    return correction;
  }

  getExpenseCorrections(expenseId: string): VehicleExpenseCorrection[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM vehicle_expense_corrections WHERE vehicle_expense_id = ? ORDER BY corrected_at DESC;')
      .all(expenseId) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id,
      vehicle_expense_id: r.vehicle_expense_id,
      vehicle_id: r.vehicle_id,
      previous_amount: r.previous_amount,
      new_amount: r.new_amount,
      previous_currency: r.previous_currency,
      new_currency: r.new_currency,
      previous_category: r.previous_category,
      new_category: r.new_category,
      reason: r.reason,
      corrected_by: r.corrected_by,
      corrected_at: r.corrected_at,
    }));
  }

  // ==================== RECURRING EXPENSES ====================

  createRecurringExpense(rec: RecurringVehicleExpense): RecurringVehicleExpense {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO recurring_vehicle_expenses (
        id, vehicle_id, category, description, amount, currency, frequency,
        start_date, end_date, next_due_date, status, auto_create_expense,
        last_processed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      rec.id,
      rec.vehicle_id,
      rec.category,
      rec.description,
      rec.amount,
      rec.currency,
      rec.frequency,
      rec.start_date,
      rec.end_date ?? null,
      rec.next_due_date,
      rec.status,
      rec.auto_create_expense ? 1 : 0,
      rec.last_processed_at ?? null,
      rec.created_at,
      rec.updated_at
    );
    return rec;
  }

  getRecurringExpenseById(id: string): RecurringVehicleExpense | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM recurring_vehicle_expenses WHERE id = ?;')
      .get(id) as Record<string, any> | undefined;
    if (!row) return null;
    return this.mapRowToRecurringExpense(row);
  }

  getRecurringExpensesForVehicle(vehicleId: string): RecurringVehicleExpense[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM recurring_vehicle_expenses WHERE vehicle_id = ? ORDER BY next_due_date ASC;')
      .all(vehicleId) as Array<Record<string, any>>;
    return rows.map((r) => this.mapRowToRecurringExpense(r));
  }

  getDueRecurringExpenses(asOfUtc: string): RecurringVehicleExpense[] {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM recurring_vehicle_expenses WHERE status = 'ACTIVE' AND next_due_date <= ?;")
      .all(asOfUtc) as Array<Record<string, any>>;
    return rows.map((r) => this.mapRowToRecurringExpense(r));
  }

  updateRecurringExpense(
    id: string,
    updates: Partial<RecurringVehicleExpense>
  ): RecurringVehicleExpense {
    const db = getDatabase();
    const current = this.getRecurringExpenseById(id);
    if (!current) {
      throw new Error(`Recurring expense ${id} not found`);
    }

    const merged = { ...current, ...updates, updated_at: new Date().toISOString() };
    db.prepare(`
      UPDATE recurring_vehicle_expenses SET
        category = ?, description = ?, amount = ?, currency = ?, frequency = ?,
        start_date = ?, end_date = ?, next_due_date = ?, status = ?,
        auto_create_expense = ?, last_processed_at = ?, updated_at = ?
      WHERE id = ?;
    `).run(
      merged.category,
      merged.description,
      merged.amount,
      merged.currency,
      merged.frequency,
      merged.start_date,
      merged.end_date ?? null,
      merged.next_due_date,
      merged.status,
      merged.auto_create_expense ? 1 : 0,
      merged.last_processed_at ?? null,
      merged.updated_at,
      id
    );

    return merged;
  }

  // ==================== ROW MAPPERS ====================

  private mapRowToFuelEntry(row: Record<string, any>): FuelEntry {
    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      fueled_at: row.fueled_at,
      recorded_at: row.recorded_at,
      odometer_value: row.odometer_value,
      odometer_unit: row.odometer_unit,
      odometer_km: row.odometer_km,
      fuel_type: row.fuel_type,
      quantity: row.quantity,
      quantity_unit: row.quantity_unit as FuelQuantityUnit,
      quantity_litres: row.quantity_litres,
      total_cost: row.total_cost,
      currency: row.currency,
      price_per_unit: row.price_per_unit,
      fill_type: row.fill_type as FillType,
      tank_level_before: row.tank_level_before,
      tank_level_after: row.tank_level_after,
      station_name: row.station_name,
      location_reference: row.location_reference,
      source_type: row.source_type as FuelSourceType,
      actor_id: row.actor_id,
      is_corrected: Boolean(row.is_corrected),
      correction_of_id: row.correction_of_id,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapRowToExpense(row: Record<string, any>): VehicleExpense {
    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      expense_category: row.expense_category as ExpenseCategory,
      expense_subcategory: row.expense_subcategory,
      occurred_at: row.occurred_at,
      recorded_at: row.recorded_at,
      amount: row.amount,
      currency: row.currency,
      cost_type: row.cost_type as CostType,
      status: row.status as ExpenseStatus,
      description: row.description,
      source_type: row.source_type as ExpenseSourceType,
      source_reference_type: row.source_reference_type,
      source_reference_id: row.source_reference_id,
      merchant_provider_id: row.merchant_provider_id,
      recurring_expense_id: row.recurring_expense_id,
      odometer_km: row.odometer_km,
      receipt_document_id: row.receipt_document_id,
      notes: row.notes,
      is_corrected: Boolean(row.is_corrected),
      correction_of_id: row.correction_of_id,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapRowToRecurringExpense(row: Record<string, any>): RecurringVehicleExpense {
    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      category: row.category as ExpenseCategory,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      frequency: row.frequency as RecurringFrequency,
      start_date: row.start_date,
      end_date: row.end_date,
      next_due_date: row.next_due_date,
      status: row.status as RecurringStatus,
      auto_create_expense: Boolean(row.auto_create_expense),
      last_processed_at: row.last_processed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export const fuelExpenseRepository = new FuelExpenseRepository();
