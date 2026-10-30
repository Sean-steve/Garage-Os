/**
 * Canonical Booking, Scheduling, Quotes & Service Transaction API Router (GAR-013, GAR-034)
 *
 * Implements endpoints for customer-to-provider service transaction lifecycle:
 * - Service Offerings catalog & configuration
 * - Capacity, scheduling & real-time slot availability
 * - Capacity holds (temporary reservation window)
 * - Booking request, instant confirmation, revision & cancellation
 * - Vehicle check-in transition bridging to Workshop ServiceCase (GAR-012)
 * - Service estimates & preliminary pricing
 * - Binding commercial quotes, line-item versioning & digital acceptance / authorization
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { bookingService } from '../booking/bookingService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  AccountStatus,
  AuthenticatedActorContext,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
} from '../identity/types';
import { BookingStatus, QuoteStatus } from '../booking/types';

export const bookingRouter = Router();

// Middleware: Authenticate actor context (populates req.actor)
bookingRouter.use(authenticate({ optional: true }));

function getActor(req: Request): AuthenticatedActorContext & { actor_id: string; roles: string[] } {
  if (req.actor) {
    const roles: string[] = [];
    if (req.actor.active_membership?.role) {
      roles.push(req.actor.active_membership.role);
    }
    if (req.actor.platform_roles) {
      roles.push(...req.actor.platform_roles);
    }
    return {
      ...req.actor,
      actor_id: req.actor.user_id || req.actor.id,
      roles,
    };
  }

  // Fallback dev context (Customer / Member default)
  return {
    id: 'usr_dev_customer_01',
    user_id: 'usr_dev_customer_01',
    actor_id: 'usr_dev_customer_01',
    session_id: 'sess_dev_cust_01',
    email: 'customer@garage-os.local',
    account_status: AccountStatus.ACTIVE,
    platform_roles: [],
    profile: {
      user_id: 'usr_dev_customer_01',
      display_name: 'Dev Customer',
      first_name: 'Dev',
      last_name: 'Customer',
      preferred_language: 'en',
      timezone: 'Africa/Nairobi',
      country: 'KE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    memberships: [
      {
        membership_id: 'mem_dev_cust_01',
        organization_id: 'org_dev_cust_01',
        organization_name: 'Customer Org',
        organization_type: OrganizationType.GARAGE,
        organization_status: OrganizationStatus.ACTIVE,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    ],
    active_organization_id: 'org_dev_cust_01',
    active_membership: {
      membership_id: 'mem_dev_cust_01',
      organization_id: 'org_dev_cust_01',
      organization_name: 'Customer Org',
      organization_type: OrganizationType.GARAGE,
      organization_status: OrganizationStatus.ACTIVE,
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
      permissions: [],
    },
    roles: [MembershipRole.OWNER],
  };
}

// ===========================================================================
// 1. Service Offerings
// ===========================================================================

bookingRouter.get('/offerings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      provider_id: req.query.provider_id as string | undefined,
      branch_id: req.query.branch_id as string | undefined,
      service_category_id: req.query.service_category_id as string | undefined,
      status: (req.query.status as string) || 'ACTIVE',
    };
    const offerings = bookingService.listOfferings(filters);
    res.json({ success: true, count: offerings.length, data: offerings });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/offerings/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const offering = bookingService.getOffering(req.params.id);
    res.json({ success: true, data: offering });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/offerings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const offering = bookingService.createOffering(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Provider'}` },
      req.body
    );
    res.status(201).json({ success: true, data: offering });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// 2. Capacity & Slot Availability
// ===========================================================================

bookingRouter.get('/capacity/slots', (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.query.provider_id as string;
    if (!providerId) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'provider_id query parameter is required', 400);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const fromDate = (req.query.from_date as string) || todayStr;
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const toDate = (req.query.to_date as string) || futureDate;

    const slots = bookingService.getAvailableSlots({
      provider_id: providerId,
      branch_id: req.query.branch_id as string | undefined,
      from_date: fromDate,
      to_date: toDate,
      duration_minutes: req.query.duration_minutes ? Number(req.query.duration_minutes) : undefined,
    });

    res.json({ success: true, count: slots.length, data: slots });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/capacity/holds', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const hold = bookingService.createCapacityHold(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Customer'}` },
      req.body
    );
    res.status(201).json({ success: true, data: hold });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// 3. Bookings
// ===========================================================================

bookingRouter.post('/bookings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const booking = bookingService.createBooking(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Customer'}` },
      req.body
    );
    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/bookings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      customer_user_id: req.query.customer_user_id as string | undefined,
      provider_id: req.query.provider_id as string | undefined,
      branch_id: req.query.branch_id as string | undefined,
      vehicle_id: req.query.vehicle_id as string | undefined,
      status: req.query.status as BookingStatus | undefined,
    };
    const bookings = bookingService.listBookings(filters);
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/bookings/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const booking = bookingService.getBooking(req.params.id);
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/confirm', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const booking = bookingService.confirmBooking(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.params.id,
      req.body
    );
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/reschedule', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const revision = bookingService.proposeReschedule(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'User'}` },
      req.params.id,
      req.body
    );
    res.status(201).json({ success: true, data: revision });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/reschedule/accept', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { revision_id } = req.body;
    if (!revision_id) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'revision_id is required', 400);
    }
    const booking = bookingService.acceptReschedule(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'User'}` },
      req.params.id,
      revision_id
    );
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/cancel', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const booking = bookingService.cancelBooking(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'User'}` },
      req.params.id,
      req.body
    );
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/check-in', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const result = bookingService.checkInBooking(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Service Advisor'}` },
      req.params.id,
      req.body
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/bookings/:id/complete', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const booking = bookingService.completeBooking(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.params.id
    );
    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// 4. Estimates
// ===========================================================================

bookingRouter.post('/estimates', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const estimate = bookingService.createEstimate(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.body
    );
    res.status(201).json({ success: true, data: estimate });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// 5. Quotes & Line Item Authorizations
// ===========================================================================

bookingRouter.post('/quotes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const quote = bookingService.createQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.body
    );
    res.status(201).json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/quotes', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      booking_id: req.query.booking_id as string | undefined,
      service_case_id: req.query.service_case_id as string | undefined,
      provider_id: req.query.provider_id as string | undefined,
      customer_user_id: req.query.customer_user_id as string | undefined,
      status: req.query.status as QuoteStatus | undefined,
    };
    const quotes = bookingService.listQuotes(filters);
    res.json({ success: true, count: quotes.length, data: quotes });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/quotes/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const quote = bookingService.getQuote(req.params.id);
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/quotes/:id/issue', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const quote = bookingService.issueQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.params.id
    );
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/quotes/:id/view', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const quote = bookingService.viewQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Customer'}` },
      req.params.id
    );
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/quotes/:id/accept', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const result = bookingService.acceptQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Customer'}` },
      req.params.id,
      req.body
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/quotes/:id/reject', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const quote = bookingService.rejectQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Customer'}` },
      req.params.id,
      req.body
    );
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/quotes/:id/revise', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const revision = bookingService.reviseQuote(
      { actor_id: actor.actor_id, roles: actor.roles, name: `${actor.profile?.display_name || 'Advisor'}` },
      req.params.id,
      req.body
    );
    res.status(201).json({ success: true, data: revision });
  } catch (err) {
    next(err);
  }
});
