/**
 * Canonical Identity & Access Express API Router (GAR-034, GAR-039)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../identity/authService';
import { organizationService } from '../identity/organizationService';
import { adminService } from '../identity/adminService';
import { authenticate, requirePermission } from './authMiddleware';
import { CanonicalPermission, getCanonicalPermissionMatrix } from '../identity/rbac';
import { AccountStatus, MembershipRole, OrganizationType } from '../identity/types';

export const authRouter = Router();

// ==========================================
// 1. Authentication & Registration Endpoints
// ==========================================

authRouter.post('/auth/register', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, fullName, phone } = req.body;
    const result = authService.registerUser({
      email,
      password,
      fullName,
      phone,
      correlationId: (req as any).correlationId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, deviceInfo } = req.body;
    const result = authService.loginUser({
      email,
      password,
      deviceInfo,
      ipAddress: req.ip,
      correlationId: (req as any).correlationId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-session-token'] as string);
    authService.logout(token, (req as any).correlationId);
    res.json({ message: 'Successfully logged out' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout-all', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    authService.logoutAll(req.actor!.id, (req as any).correlationId);
    res.json({ message: 'All active sessions revoked' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/verify-email', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, code } = req.body;
    authService.verifyEmail(userId, code, (req as any).correlationId);
    res.json({ message: 'Email successfully verified' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/request-password-reset', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const result = authService.requestPasswordReset(email, (req as any).correlationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/reset-password', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    authService.resetPassword(token, newPassword, (req as any).correlationId);
    res.json({ message: 'Password successfully reset' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/sessions', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = authService.listSessions(req.actor!.id, req.actor!.session_id);
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/auth/sessions/:id', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    authService.revokeSession(req.actor!.id, req.params.id, (req as any).correlationId);
    res.json({ message: 'Session revoked' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/permissions/matrix', (_req: Request, res: Response) => {
  res.json(getCanonicalPermissionMatrix());
});

// ==========================================
// 2. Personal Identity & Profile (/me)
// ==========================================

authRouter.get('/me', authenticate(), (req: Request, res: Response) => {
  res.json(req.actor);
});

authRouter.patch('/me/profile', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = authService.updateProfile(req.actor!.id, req.body, (req as any).correlationId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/me/change-password', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    authService.changePassword(req.actor!.id, currentPassword, newPassword, (req as any).correlationId);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. Organization Tenancy & Membership
// ==========================================

authRouter.post('/organizations', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type } = req.body;
    const result = organizationService.createOrganization(req.actor!, {
      name,
      type: type as OrganizationType,
      correlationId: (req as any).correlationId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/organizations', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = organizationService.listOrganizationsForActor(req.actor!);
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/organizations/:id', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = organizationService.getOrganization(req.actor!, req.params.id);
    res.json(org);
  } catch (err) {
    next(err);
  }
});

authRouter.patch('/organizations/:id', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = organizationService.updateOrganization(
      req.actor!,
      req.params.id,
      req.body,
      (req as any).correlationId
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/organizations/:id/members', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const members = organizationService.listMembers(req.actor!, req.params.id);
    res.json(members);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/organizations/:id/invitations', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body;
    const result = organizationService.inviteMember(
      req.actor!,
      req.params.id,
      email,
      role as MembershipRole,
      (req as any).correlationId
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/organizations/invitations/accept', authenticate(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    const result = organizationService.acceptInvitation(req.actor!, token, (req as any).correlationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.patch(
  '/organizations/:id/members/:membershipId',
  authenticate(),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role } = req.body;
      organizationService.updateMemberRole(
        req.actor!,
        req.params.id,
        req.params.membershipId,
        role as MembershipRole,
        (req as any).correlationId
      );
      res.json({ message: 'Role updated successfully' });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.delete(
  '/organizations/:id/members/:membershipId',
  authenticate(),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      organizationService.revokeMembership(
        req.actor!,
        req.params.id,
        req.params.membershipId,
        (req as any).correlationId
      );
      res.json({ message: 'Membership revoked' });
    } catch (err) {
      next(err);
    }
  }
);

// ==========================================
// 4. Platform Administration & Governance
// ==========================================

authRouter.get(
  '/admin/users',
  authenticate(),
  requirePermission(CanonicalPermission.ADMIN_USERS_READ),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = req.query.search as string;
      const status = req.query.status as AccountStatus;
      const users = adminService.listUsers(req.actor!, { search, status });
      res.json(users);
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/admin/users/:userId/status',
  authenticate(),
  requirePermission(CanonicalPermission.ADMIN_USERS_SUSPEND),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, reason } = req.body;
      adminService.updateAccountStatus(
        req.actor!,
        req.params.userId,
        status as AccountStatus,
        reason,
        (req as any).correlationId
      );
      res.json({ message: `User status updated to ${status}` });
    } catch (err) {
      next(err);
    }
  }
);
