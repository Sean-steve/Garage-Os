/**
 * Canonical Total Cost of Ownership (TCO) & Analytics Engine (GAR-009 §19-22, §33-38, §64)
 *
 * Implements period aggregation, category breakdown, cost-per-km calculation,
 * distinct actual vs. estimated cost separation, and multi-currency safety.
 */

import {
  CostType,
  ExpenseCategory,
  ExpenseStatus,
  PeriodCostSummary,
  RecurringStatus,
  RecurringVehicleExpense,
  TotalCostOfOwnershipSummary,
  VehicleExpense,
} from './types';
import { MoneyUtil } from './money';

export class TcoEngine {
  /**
   * Resolves date bounds for standard or custom periods.
   */
  static getPeriodBounds(
    period: string,
    customFrom?: string,
    customTo?: string
  ): { from: Date; to: Date } {
    const now = new Date();
    const to = customTo ? new Date(customTo) : now;

    switch (period.toUpperCase()) {
      case 'THIS_MONTH': {
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { from, to };
      }
      case 'LAST_3_MONTHS': {
        const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        return { from, to };
      }
      case 'LAST_6_MONTHS': {
        const from = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        return { from, to };
      }
      case 'LAST_12_MONTHS': {
        const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return { from, to };
      }
      case 'CUSTOM': {
        const from = customFrom
          ? new Date(customFrom)
          : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return { from, to };
      }
      case 'ALL_TIME':
      default: {
        const from = new Date(0); // Epoch start
        return { from, to };
      }
    }
  }

  /**
   * Generates a canonical Total Cost of Ownership summary for a vehicle.
   */
  static calculateTco(
    vehicleId: string,
    expenses: VehicleExpense[],
    recurringExpenses: RecurringVehicleExpense[],
    period = 'ALL_TIME',
    customFrom?: string,
    customTo?: string,
    odometerReadings?: Array<{ km: number; recorded_at: string }>
  ): TotalCostOfOwnershipSummary {
    const { from, to } = this.getPeriodBounds(period, customFrom, customTo);
    const fromTime = from.getTime();
    const toTime = to.getTime();

    // Filter expenses within period and exclude voided or superseded records
    const inPeriodExpenses = expenses.filter((e) => {
      if (e.status === ExpenseStatus.VOIDED || e.is_corrected) return false;
      const occurredTime = new Date(e.occurred_at).getTime();
      return occurredTime >= fromTime && occurredTime <= toTime;
    });

    // Group expenses by currency
    const expensesByCurrency = new Map<string, VehicleExpense[]>();
    for (const exp of inPeriodExpenses) {
      const cur = MoneyUtil.normalizeCurrency(exp.currency);
      const list = expensesByCurrency.get(cur) ?? [];
      list.push(exp);
      expensesByCurrency.set(cur, list);
    }

    // Determine period days for daily/monthly projections
    const periodDays = Math.max(1, (toTime - fromTime) / (24 * 60 * 60 * 1000));

    // Distance in period from odometer readings
    let distanceCoveredKm: number | null = null;
    if (odometerReadings && odometerReadings.length >= 2) {
      const sortedOdos = [...odometerReadings]
        .filter((o) => {
          const t = new Date(o.recorded_at).getTime();
          return t >= fromTime && t <= toTime;
        })
        .sort((a, b) => a.km - b.km);

      if (sortedOdos.length >= 2) {
        const delta = sortedOdos[sortedOdos.length - 1].km - sortedOdos[0].km;
        if (delta > 0) {
          distanceCoveredKm = Math.round(delta * 100) / 100;
        }
      }
    }

    const byCurrencySummary: Record<string, PeriodCostSummary> = {};
    const defaultCurrency = 'KES';

    // If no expenses in period, create empty summary for default currency
    if (expensesByCurrency.size === 0) {
      byCurrencySummary[defaultCurrency] = this.createEmptySummary(
        defaultCurrency,
        distanceCoveredKm
      );
    } else {
      for (const [currency, currExpenses] of expensesByCurrency.entries()) {
        let totalActual = 0;
        let totalEstimated = 0;
        let totalRecurringExpected = 0;

        const byCategory: Record<ExpenseCategory, number> = {
          [ExpenseCategory.FUEL]: 0,
          [ExpenseCategory.MAINTENANCE]: 0,
          [ExpenseCategory.REPAIR]: 0,
          [ExpenseCategory.PARTS]: 0,
          [ExpenseCategory.TYRES]: 0,
          [ExpenseCategory.INSURANCE]: 0,
          [ExpenseCategory.INSPECTION]: 0,
          [ExpenseCategory.PARKING]: 0,
          [ExpenseCategory.TOLLS]: 0,
          [ExpenseCategory.WASH_DETAILING]: 0,
          [ExpenseCategory.ROADSIDE]: 0,
          [ExpenseCategory.TOWING]: 0,
          [ExpenseCategory.MODIFICATION]: 0,
          [ExpenseCategory.REGISTRATION]: 0,
          [ExpenseCategory.FINANCE]: 0,
          [ExpenseCategory.OTHER]: 0,
        };

        for (const exp of currExpenses) {
          if (
            exp.cost_type === CostType.ACTUAL &&
            exp.status === ExpenseStatus.CONFIRMED
          ) {
            totalActual = MoneyUtil.roundMoney(totalActual + exp.amount, currency);
            byCategory[exp.expense_category] = MoneyUtil.roundMoney(
              byCategory[exp.expense_category] + exp.amount,
              currency
            );
          } else if (
            exp.cost_type === CostType.ESTIMATED ||
            exp.status === ExpenseStatus.ESTIMATED
          ) {
            totalEstimated = MoneyUtil.roundMoney(totalEstimated + exp.amount, currency);
          } else if (exp.cost_type === CostType.RECURRING_EXPECTED) {
            totalRecurringExpected = MoneyUtil.roundMoney(
              totalRecurringExpected + exp.amount,
              currency
            );
          }
        }

        // Compute percentages of actual spend
        const categoryPercentages: Record<ExpenseCategory, number> = { ...byCategory };
        for (const cat of Object.values(ExpenseCategory)) {
          if (totalActual > 0) {
            categoryPercentages[cat] =
              Math.round((byCategory[cat] / totalActual) * 10000) / 100;
          } else {
            categoryPercentages[cat] = 0;
          }
        }

        // Cost per km calculation
        let costPerKm: number | null = null;
        let costPerKmStatus: 'CALCULATED' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
        if (distanceCoveredKm !== null && distanceCoveredKm > 0 && totalActual > 0) {
          costPerKm = Math.round((totalActual / distanceCoveredKm) * 100) / 100;
          costPerKmStatus = 'CALCULATED';
        }

        // Daily / Monthly / Annualized projections
        const averageDailyCost = Math.round((totalActual / periodDays) * 100) / 100;
        const averageMonthlyCost = Math.round(averageDailyCost * 30.4375 * 100) / 100;
        const annualizedProjectedCost = Math.round(averageDailyCost * 365.25 * 100) / 100;

        byCurrencySummary[currency] = {
          currency,
          totalActual,
          totalEstimated,
          totalRecurringExpected,
          byCategory,
          categoryPercentages,
          distanceCoveredKm,
          costPerKm,
          costPerKmStatus,
          averageDailyCost,
          averageMonthlyCost,
          annualizedProjectedCost,
          isAnnualizedProjection: true,
        };
      }
    }

    // Monthly trends (grouping by YYYY-MM and currency)
    const monthlyMap = new Map<
      string,
      {
        month: string;
        currency: string;
        actualAmount: number;
        byCategory: Partial<Record<ExpenseCategory, number>>;
      }
    >();

    for (const exp of inPeriodExpenses) {
      if (
        exp.cost_type !== CostType.ACTUAL ||
        exp.status !== ExpenseStatus.CONFIRMED
      ) {
        continue;
      }
      const d = new Date(exp.occurred_at);
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const cur = MoneyUtil.normalizeCurrency(exp.currency);
      const groupKey = `${monthKey}:${cur}`;

      const item = monthlyMap.get(groupKey) ?? {
        month: monthKey,
        currency: cur,
        actualAmount: 0,
        byCategory: {},
      };

      item.actualAmount = MoneyUtil.roundMoney(item.actualAmount + exp.amount, cur);
      const prevCat = item.byCategory[exp.expense_category] ?? 0;
      item.byCategory[exp.expense_category] = MoneyUtil.roundMoney(prevCat + exp.amount, cur);
      monthlyMap.set(groupKey, item);
    }

    const monthlyTrends = Array.from(monthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    // Active recurring expected totals by currency
    const activeRecurringExpectedTotal: Record<string, number> = {};
    const activeRecurring = recurringExpenses.filter((r) => r.status === RecurringStatus.ACTIVE);
    for (const rec of activeRecurring) {
      const cur = MoneyUtil.normalizeCurrency(rec.currency);
      activeRecurringExpectedTotal[cur] = MoneyUtil.roundMoney(
        (activeRecurringExpectedTotal[cur] ?? 0) + rec.amount,
        cur
      );
    }

    const currencies = Object.keys(byCurrencySummary);
    const primaryCurrency = currencies[0] ?? defaultCurrency;

    return {
      vehicleId,
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      hasMixedCurrencies: currencies.length > 1,
      primaryCurrency,
      byCurrency: byCurrencySummary,
      monthlyTrends,
      recurringExpensesCount: activeRecurring.length,
      activeRecurringExpectedTotal,
    };
  }

  private static createEmptySummary(
    currency: string,
    distanceKm: number | null
  ): PeriodCostSummary {
    const emptyCats = Object.values(ExpenseCategory).reduce(
      (acc, cat) => {
        acc[cat] = 0;
        return acc;
      },
      {} as Record<ExpenseCategory, number>
    );

    return {
      currency,
      totalActual: 0,
      totalEstimated: 0,
      totalRecurringExpected: 0,
      byCategory: emptyCats,
      categoryPercentages: { ...emptyCats },
      distanceCoveredKm: distanceKm,
      costPerKm: null,
      costPerKmStatus: 'INSUFFICIENT_DATA',
      averageDailyCost: 0,
      averageMonthlyCost: 0,
      annualizedProjectedCost: 0,
      isAnnualizedProjection: true,
    };
  }
}
