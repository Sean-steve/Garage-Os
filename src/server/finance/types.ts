/**
 * Canonical Fuel, Expense & Total Cost of Ownership Architecture (GAR-009, GAR-033, GAR-034)
 */

export enum FuelQuantityUnit {
  LITRE = 'LITRE',
  GALLON_US = 'GALLON_US',
  GALLON_UK = 'GALLON_UK',
  KWH = 'KWH',
}

export enum FillType {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
  UNKNOWN = 'UNKNOWN',
}

export enum FuelSourceType {
  OWNER_ENTERED = 'OWNER_ENTERED',
  SERVICE_PROVIDER = 'SERVICE_PROVIDER',
  FLEET_LOG = 'FLEET_LOG',
  EXTERNAL_IMPORTED = 'EXTERNAL_IMPORTED',
  SYSTEM_DERIVED = 'SYSTEM_DERIVED',
}

export enum FuelEconomyUnit {
  KM_PER_LITRE = 'KM_PER_LITRE',
  LITRES_PER_100_KM = 'LITRES_PER_100_KM',
  MPG_US = 'MPG_US',
  MPG_UK = 'MPG_UK',
}

export enum FuelEconomyConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

export enum ExpenseCategory {
  FUEL = 'FUEL',
  MAINTENANCE = 'MAINTENANCE',
  REPAIR = 'REPAIR',
  PARTS = 'PARTS',
  TYRES = 'TYRES',
  INSURANCE = 'INSURANCE',
  INSPECTION = 'INSPECTION',
  PARKING = 'PARKING',
  TOLLS = 'TOLLS',
  WASH_DETAILING = 'WASH_DETAILING',
  ROADSIDE = 'ROADSIDE',
  TOWING = 'TOWING',
  MODIFICATION = 'MODIFICATION',
  REGISTRATION = 'REGISTRATION',
  FINANCE = 'FINANCE',
  OTHER = 'OTHER',
}

export enum CostType {
  ACTUAL = 'ACTUAL',
  ESTIMATED = 'ESTIMATED',
  PROJECTED = 'PROJECTED',
  RECURRING_EXPECTED = 'RECURRING_EXPECTED',
}

export enum ExpenseStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  VOIDED = 'VOIDED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  ESTIMATED = 'ESTIMATED',
}

export enum ExpenseSourceType {
  OWNER_ENTERED = 'OWNER_ENTERED',
  SERVICE_TRANSACTION = 'SERVICE_TRANSACTION',
  MARKETPLACE_ORDER = 'MARKETPLACE_ORDER',
  PAYMENT_RECORD = 'PAYMENT_RECORD',
  INSURANCE_RECORD = 'INSURANCE_RECORD',
  SYSTEM_DERIVED = 'SYSTEM_DERIVED',
  EXTERNAL_IMPORTED = 'EXTERNAL_IMPORTED',
}

export enum RecurringFrequency {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
  CUSTOM = 'CUSTOM',
}

export enum RecurringStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export interface FuelEntry {
  id: string;
  vehicle_id: string;
  fueled_at: string;
  recorded_at: string;
  odometer_value?: number | null;
  odometer_unit?: string | null;
  odometer_km?: number | null;
  fuel_type: string;
  quantity: number;
  quantity_unit: FuelQuantityUnit;
  quantity_litres: number;
  total_cost: number;
  currency: string;
  price_per_unit?: number | null;
  fill_type: FillType;
  tank_level_before?: number | null;
  tank_level_after?: number | null;
  station_name?: string | null;
  location_reference?: string | null;
  source_type: FuelSourceType;
  actor_id: string;
  is_corrected: boolean;
  correction_of_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FuelEconomyInterval {
  id: string;
  vehicle_id: string;
  start_fuel_entry_id: string;
  end_fuel_entry_id: string;
  distance_km: number;
  fuel_consumed_litres: number;
  km_per_litre: number;
  litres_per_100_km: number;
  mpg_us: number;
  mpg_uk: number;
  confidence: FuelEconomyConfidence;
  partial_fills_included_count: number;
  calculated_at: string;
}

export interface FuelEfficiencySnapshot {
  id: string;
  vehicle_id: string;
  rolling_economy_km_l: number;
  baseline_economy_km_l: number;
  delta_percent: number;
  anomaly_detected: boolean;
  observation_text?: string | null;
  data_quality: string;
  qualifying_intervals_count: number;
  total_distance_km: number;
  observed_at: string;
  created_at: string;
}

export interface VehicleExpense {
  id: string;
  vehicle_id: string;
  expense_category: ExpenseCategory;
  expense_subcategory?: string | null;
  occurred_at: string;
  recorded_at: string;
  amount: number;
  currency: string;
  cost_type: CostType;
  status: ExpenseStatus;
  description: string;
  source_type: ExpenseSourceType;
  source_reference_type?: string | null;
  source_reference_id?: string | null;
  merchant_provider_id?: string | null;
  recurring_expense_id?: string | null;
  odometer_km?: number | null;
  receipt_document_id?: string | null;
  notes?: string | null;
  is_corrected: boolean;
  correction_of_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleExpenseCorrection {
  id: string;
  vehicle_expense_id: string;
  vehicle_id: string;
  previous_amount: number;
  new_amount: number;
  previous_currency: string;
  new_currency: string;
  previous_category: string;
  new_category: string;
  reason: string;
  corrected_by: string;
  corrected_at: string;
}

export interface RecurringVehicleExpense {
  id: string;
  vehicle_id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string | null;
  next_due_date: string;
  status: RecurringStatus;
  auto_create_expense: boolean;
  last_processed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodCostSummary {
  currency: string;
  totalActual: number;
  totalEstimated: number;
  totalRecurringExpected: number;
  byCategory: Record<ExpenseCategory, number>;
  categoryPercentages: Record<ExpenseCategory, number>;
  distanceCoveredKm: number | null;
  costPerKm: number | null;
  costPerKmStatus: 'CALCULATED' | 'INSUFFICIENT_DATA';
  averageDailyCost: number;
  averageMonthlyCost: number;
  annualizedProjectedCost: number;
  isAnnualizedProjection: true;
}

export interface TotalCostOfOwnershipSummary {
  vehicleId: string;
  period: string; // 'THIS_MONTH' | 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'LAST_12_MONTHS' | 'ALL_TIME' | 'CUSTOM'
  from?: string;
  to?: string;
  hasMixedCurrencies: boolean;
  primaryCurrency: string;
  byCurrency: Record<string, PeriodCostSummary>;
  monthlyTrends: Array<{
    month: string; // YYYY-MM
    currency: string;
    actualAmount: number;
    byCategory: Partial<Record<ExpenseCategory, number>>;
  }>;
  recurringExpensesCount: number;
  activeRecurringExpectedTotal: Record<string, number>;
}

export interface FuelSummaryDto {
  vehicleId: string;
  period: string;
  from?: string;
  to?: string;
  currency: string;
  totalSpend: number;
  totalEntriesCount: number;
  totalQuantityLitres: number;
  averagePricePerLitre: number | null;
  distanceCoveredKm: number | null;
  averageFuelEconomyKmPerLitre: number | null;
  costPerKm: number | null;
  fuelEconomyStatus: FuelEconomyConfidence;
  fuelEconomyDetails?: {
    kmPerLitre: number | null;
    litresPer100Km: number | null;
    mpgUs: number | null;
    mpgUk: number | null;
    qualifyingIntervalsCount: number;
  };
  byCurrency: Record<string, { totalSpend: number; averagePricePerLitre: number | null }>;
  latestEconomy?: {
    kmPerLitre: number;
    confidence: FuelEconomyConfidence;
    calculatedAt: string;
  } | null;
  anomalyObservation?: {
    detected: boolean;
    text: string;
    rollingEconomy: number;
    baselineEconomy: number;
    deltaPercent: number;
    observedAt: string;
  } | null;
}
