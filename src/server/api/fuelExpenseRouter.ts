/**
 * Canonical Fuel, Expense & Total Cost of Ownership API Router (GAR-009, GAR-034)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { fuelExpenseService } from '../finance/fuelExpenseService';
import {
  CostType,
  ExpenseCategory,
  ExpenseSourceType,
  ExpenseStatus,
  FillType,
  FuelQuantityUnit,
  FuelSourceType,
  RecurringFrequency,
} from '../finance/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export const fuelExpenseRouter = Router();

// Middleware: Authenticate actor context (populates req.actor)
fuelExpenseRouter.use(authenticate());

function getActor(req: Request) {
  if (!req.actor) {
    throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Authentication required', 401);
  }
  return req.actor;
}

// ==================== FUEL ENDPOINTS ====================

/**
 * 1. POST /api/v1/vehicles/:id/fuel
 * Records a new fuel purchase, normalizes units, calculates intervals and evaluates anomalies.
 */
fuelExpenseRouter.post('/vehicles/:id/fuel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const {
      fueled_at,
      odometer_value,
      odometer_unit,
      fuel_type,
      quantity,
      quantity_unit,
      total_cost,
      currency,
      fill_type,
      tank_level_before,
      tank_level_after,
      station_name,
      location_reference,
      source_type,
      notes,
    } = req.body;

    const result = await fuelExpenseService.recordFuelEntry(actor, vehicleId, {
      fueled_at,
      odometer_value: odometer_value !== undefined ? Number(odometer_value) : null,
      odometer_unit,
      fuel_type,
      quantity: Number(quantity),
      quantity_unit: quantity_unit as FuelQuantityUnit,
      total_cost: Number(total_cost),
      currency,
      fill_type: fill_type as FillType,
      tank_level_before: tank_level_before !== undefined ? Number(tank_level_before) : null,
      tank_level_after: tank_level_after !== undefined ? Number(tank_level_after) : null,
      station_name,
      location_reference,
      source_type: source_type as FuelSourceType,
      notes,
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Fuel purchase recorded successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/v1/vehicles/:id/fuel
 * Retrieves historical fuel purchase entries for vehicle.
 */
fuelExpenseRouter.get('/vehicles/:id/fuel', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const entries = fuelExpenseService.getFuelEntries(actor, vehicleId);
    res.json({
      success: true,
      data: entries,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. GET /api/v1/vehicles/:id/fuel/summary
 * Retrieves aggregated fuel summary including average spend, consumption, economy, and anomalies.
 */
fuelExpenseRouter.get('/vehicles/:id/fuel/summary', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const { period, from, to } = req.query;

    const summary = fuelExpenseService.getFuelSummary(
      actor,
      vehicleId,
      typeof period === 'string' ? period : 'ALL_TIME',
      typeof from === 'string' ? from : undefined,
      typeof to === 'string' ? to : undefined
    );

    const totalSpendByCurrency: Record<string, number> = {};
    const avgPriceByCurrency: Record<string, number> = {};
    const costPerKmByCurrency: Record<string, number> = {};

    if (summary.byCurrency) {
      for (const [cur, val] of Object.entries(summary.byCurrency)) {
        totalSpendByCurrency[cur] = val.totalSpend;
        if (val.averagePricePerLitre !== null && val.averagePricePerLitre !== undefined) {
          avgPriceByCurrency[cur] = val.averagePricePerLitre;
        }
      }
    }
    if (summary.currency && summary.costPerKm !== null && summary.costPerKm !== undefined) {
      costPerKmByCurrency[summary.currency] = summary.costPerKm;
    }

    const clientPayload = {
      ...summary,
      vehicle_id: summary.vehicleId,
      total_fuel_entries: summary.totalEntriesCount,
      total_spend_by_currency: totalSpendByCurrency,
      total_litres_consumed: summary.totalQuantityLitres,
      average_price_per_litre_by_currency: avgPriceByCurrency,
      rolling_economy_km_l: summary.averageFuelEconomyKmPerLitre,
      rolling_economy_l_100km: summary.fuelEconomyDetails?.litresPer100Km ?? null,
      rolling_economy_mpg_us: summary.fuelEconomyDetails?.mpgUs ?? null,
      rolling_economy_mpg_uk: summary.fuelEconomyDetails?.mpgUk ?? null,
      cost_per_km_by_currency: costPerKmByCurrency,
      anomaly_detected: summary.anomalyObservation?.detected ?? false,
      anomaly_message: summary.anomalyObservation?.text ?? null,
    };

    res.json({
      success: true,
      data: clientPayload,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. GET /api/v1/vehicles/:id/fuel/intervals
 * Retrieves calculated full-to-full fuel economy intervals.
 */
fuelExpenseRouter.get('/vehicles/:id/fuel/intervals', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const intervals = fuelExpenseService.getFuelEconomyIntervals(actor, vehicleId);
    res.json({
      success: true,
      data: intervals,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. GET /api/v1/fuel/:id
 * Retrieves a single fuel entry by ID.
 */
fuelExpenseRouter.get('/fuel/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const entry = fuelExpenseService.getFuelEntryById(actor, req.params.id);
    res.json({
      success: true,
      data: entry,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. PATCH /api/v1/fuel/:id
 * Corrects an erroneous fuel entry with audit logging.
 */
fuelExpenseRouter.patch('/fuel/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const fuelEntryId = req.params.id;
    const {
      fueled_at,
      odometer_value,
      odometer_unit,
      fuel_type,
      quantity,
      quantity_unit,
      total_cost,
      currency,
      fill_type,
      station_name,
      notes,
      correction_reason,
    } = req.body;

    const result = await fuelExpenseService.correctFuelEntry(actor, fuelEntryId, {
      fueled_at,
      odometer_value: odometer_value !== undefined ? Number(odometer_value) : undefined,
      odometer_unit,
      fuel_type,
      quantity: quantity !== undefined ? Number(quantity) : undefined,
      quantity_unit: quantity_unit as FuelQuantityUnit,
      total_cost: total_cost !== undefined ? Number(total_cost) : undefined,
      currency,
      fill_type: fill_type as FillType,
      station_name,
      notes,
      correction_reason,
    });

    res.json({
      success: true,
      data: result,
      message: 'Fuel entry corrected successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== EXPENSE ENDPOINTS ====================

/**
 * 7. POST /api/v1/vehicles/:id/expenses
 * Records a vehicle expense.
 */
fuelExpenseRouter.post('/vehicles/:id/expenses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const {
      expense_category,
      expense_subcategory,
      occurred_at,
      amount,
      currency,
      cost_type,
      status,
      description,
      source_type,
      source_reference_type,
      source_reference_id,
      merchant_provider_id,
      recurring_expense_id,
      odometer_km,
      receipt_document_id,
      notes,
    } = req.body;

    const expense = await fuelExpenseService.recordExpense(actor, vehicleId, {
      expense_category: expense_category as ExpenseCategory,
      expense_subcategory,
      occurred_at,
      amount: Number(amount),
      currency,
      cost_type: cost_type as CostType,
      status: status as ExpenseStatus,
      description,
      source_type: source_type as ExpenseSourceType,
      source_reference_type,
      source_reference_id,
      merchant_provider_id,
      recurring_expense_id,
      odometer_km: odometer_km !== undefined ? Number(odometer_km) : undefined,
      receipt_document_id,
      notes,
    });

    res.status(201).json({
      success: true,
      data: expense,
      message: 'Vehicle expense recorded successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 8. GET /api/v1/vehicles/:id/expenses
 * Lists vehicle expenses with optional category and cost type filters.
 */
fuelExpenseRouter.get('/vehicles/:id/expenses', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const { category, cost_type, from, to } = req.query;

    const expenses = fuelExpenseService.getExpenses(actor, vehicleId, {
      category: typeof category === 'string' ? (category as ExpenseCategory) : undefined,
      costType: typeof cost_type === 'string' ? (cost_type as CostType) : undefined,
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
    });

    res.json({
      success: true,
      data: expenses,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 9. GET /api/v1/expenses/:id
 * Retrieves single expense by ID.
 */
fuelExpenseRouter.get('/expenses/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const expense = fuelExpenseService.getExpenseById(actor, req.params.id);
    res.json({
      success: true,
      data: expense,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 10. PATCH /api/v1/expenses/:id
 * Corrects an expense with full audit trail.
 */
fuelExpenseRouter.patch('/expenses/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const expenseId = req.params.id;
    const { amount, currency, expense_category, description, occurred_at, reason } = req.body;

    const updated = await fuelExpenseService.correctExpense(actor, expenseId, {
      amount: amount !== undefined ? Number(amount) : undefined,
      currency,
      expense_category: expense_category as ExpenseCategory,
      description,
      occurred_at,
      reason,
    });

    res.json({
      success: true,
      data: updated,
      message: 'Expense corrected successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== RECURRING EXPENSE ENDPOINTS ====================

/**
 * 11. GET /api/v1/vehicles/:id/expenses/recurring
 * Lists recurring expense schedules for vehicle.
 */
fuelExpenseRouter.get('/vehicles/:id/expenses/recurring', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const recurring = fuelExpenseService.getRecurringExpenses(actor, vehicleId);
    res.json({
      success: true,
      data: recurring,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 12. POST /api/v1/vehicles/:id/expenses/recurring
 * Creates a recurring expense schedule (insurance, inspection, parking, etc.).
 */
fuelExpenseRouter.post('/vehicles/:id/expenses/recurring', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const { category, description, amount, currency, frequency, start_date, end_date, auto_create_expense } =
      req.body;

    const rec = fuelExpenseService.createRecurringExpense(actor, vehicleId, {
      category: category as ExpenseCategory,
      description,
      amount: Number(amount),
      currency,
      frequency: frequency as RecurringFrequency,
      start_date,
      end_date,
      auto_create_expense,
    });

    res.status(201).json({
      success: true,
      data: rec,
      message: 'Recurring expense schedule created successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 13. PATCH /api/v1/expenses/recurring/:id
 * Updates a recurring expense schedule.
 */
fuelExpenseRouter.patch('/expenses/recurring/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const recurringExpenseId = req.params.id;
    const updates = req.body;

    const updated = fuelExpenseService.updateRecurringExpense(actor, recurringExpenseId, updates);
    res.json({
      success: true,
      data: updated,
      message: 'Recurring expense schedule updated successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== TOTAL COST OF OWNERSHIP (TCO) ====================

/**
 * 14. GET /api/v1/vehicles/:id/tco
 * Calculates canonical Total Cost of Ownership summary.
 */
fuelExpenseRouter.get('/vehicles/:id/tco', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const { period, from, to } = req.query;

    const tco = fuelExpenseService.getTcoSummary(
      actor,
      vehicleId,
      typeof period === 'string' ? period : 'ALL_TIME',
      typeof from === 'string' ? from : undefined,
      typeof to === 'string' ? to : undefined
    );

    const totalByCurrency: Record<string, number> = {};
    const costPerKmByCurrency: Record<string, number> = {};
    const categoryBreakdown: Array<{ category: string; amount: number; currency: string; percentage: number }> = [];

    if (tco.byCurrency) {
      for (const [cur, periodSummary] of Object.entries(tco.byCurrency)) {
        totalByCurrency[cur] = periodSummary.totalActual;
        if (periodSummary.costPerKm !== null && periodSummary.costPerKm !== undefined) {
          costPerKmByCurrency[cur] = periodSummary.costPerKm;
        }
        if (periodSummary.byCategory) {
          for (const [cat, amt] of Object.entries(periodSummary.byCategory)) {
            const pct = (periodSummary.categoryPercentages as Record<string, number>)?.[cat] ?? 0;
            categoryBreakdown.push({
              category: cat,
              amount: amt,
              currency: cur,
              percentage: pct,
            });
          }
        }
      }
    }

    const clientPayload = {
      ...tco,
      vehicle_id: tco.vehicleId,
      total_by_currency: totalByCurrency,
      cost_per_km_by_currency: costPerKmByCurrency,
      category_breakdown: categoryBreakdown,
      primary_currency: tco.primaryCurrency,
    };

    res.json({
      success: true,
      data: clientPayload,
    });
  } catch (err) {
    next(err);
  }
});
