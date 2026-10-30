/**
 * Canonical Decimal-Safe Money & Multi-Currency Engine (GAR-009 §21-22, §79, §88)
 *
 * Prevents floating point inaccuracy by performing arithmetic in integer minor units (cents).
 * Strictly forbids mixing currencies numerically without an explicit exchange rate.
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';

// ISO 4217 minor unit decimals mapping
const CURRENCY_DECIMALS: Record<string, number> = {
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  UGX: 0,
  TZS: 0,
  RWF: 0,
  JPY: 0,
  ZAR: 2,
};

export class MoneyUtil {
  static getDecimals(currency: string): number {
    const upper = currency.toUpperCase();
    return CURRENCY_DECIMALS[upper] ?? 2;
  }

  /**
   * Converts a decimal monetary amount to integer minor units (e.g. 12.34 KES -> 1234 cents).
   */
  static toMinorUnits(amount: number, currency = 'KES'): bigint {
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_AMOUNT,
        `Invalid monetary amount: ${amount}`,
        400
      );
    }
    const decimals = this.getDecimals(currency);
    const multiplier = Math.pow(10, decimals);
    // Round to nearest integer to eliminate IEEE-754 floating point representation artifacts
    const scaled = Math.round(amount * multiplier);
    return BigInt(scaled);
  }

  /**
   * Converts integer minor units back to decimal monetary representation.
   */
  static fromMinorUnits(minorUnits: bigint, currency = 'KES'): number {
    const decimals = this.getDecimals(currency);
    const divisor = Math.pow(10, decimals);
    return Number(minorUnits) / divisor;
  }

  /**
   * Normalizes and rounds a decimal monetary value to its exact currency decimal precision.
   */
  static roundMoney(amount: number, currency = 'KES'): number {
    const minor = this.toMinorUnits(amount, currency);
    return this.fromMinorUnits(minor, currency);
  }

  /**
   * Adds two monetary amounts of the SAME currency. Throws if currencies differ.
   */
  static add(
    amountA: number,
    currencyA: string,
    amountB: number,
    currencyB: string
  ): { amount: number; currency: string } {
    if (currencyA.toUpperCase() !== currencyB.toUpperCase()) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_CURRENCY,
        `Cannot combine mismatched currencies: ${currencyA} and ${currencyB}. Explicit exchange rates are required.`,
        400
      );
    }
    const cur = currencyA.toUpperCase();
    const minorA = this.toMinorUnits(amountA, cur);
    const minorB = this.toMinorUnits(amountB, cur);
    const sum = minorA + minorB;
    return {
      amount: this.fromMinorUnits(sum, cur),
      currency: cur,
    };
  }

  /**
   * Sums an array of amounts of the SAME currency.
   */
  static sum(amounts: number[], currency = 'KES'): number {
    const cur = currency.toUpperCase();
    let totalMinor = BigInt(0);
    for (const amt of amounts) {
      totalMinor += this.toMinorUnits(amt, cur);
    }
    return this.fromMinorUnits(totalMinor, cur);
  }

  /**
   * Safe division for price-per-unit: totalCost / quantity.
   */
  static divide(amount: number, divisor: number, currency = 'KES'): number {
    if (divisor <= 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Division by non-positive divisor: ${divisor}`,
        400
      );
    }
    const raw = amount / divisor;
    // Retain 2-4 decimal places for unit price (e.g. 171.43 KES/L)
    return Math.round(raw * 10000) / 10000;
  }

  /**
   * Formats money with ISO currency code.
   */
  static format(amount: number, currency = 'KES'): string {
    const decimals = this.getDecimals(currency);
    const rounded = this.roundMoney(amount, currency);
    return `${currency.toUpperCase()} ${rounded.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }

  /**
   * Validates that an ISO 3-letter currency is safe and formatted.
   */
  static normalizeCurrency(currency?: string): string {
    if (!currency || typeof currency !== 'string') {
      return 'KES';
    }
    const trimmed = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(trimmed)) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_EXPENSE_INVALID_CURRENCY,
        `Invalid currency code: ${currency}. Must be a 3-letter ISO code.`,
        400
      );
    }
    return trimmed;
  }
}
