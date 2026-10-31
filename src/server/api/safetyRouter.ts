import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { safetyService } from '../safety/safetyService';
import { SafetyIncidentLevel, SosSafetyCheckResponse } from '../safety/types';
import { sosService } from '../safety/sosService';
import { trustedContactService } from '../safety/trustedContactService';

export const safetyRouter = Router();

safetyRouter.use(authenticate());

safetyRouter.get('/emergency-circle', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: safetyService.getEmergencyCircle(req.actor!) });
  } catch (err) {
    next(err);
  }
});

safetyRouter.post('/emergency-circle/contacts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const contact = safetyService.addContact(req.actor!, req.body);
    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
});

safetyRouter.patch('/emergency-circle/contacts/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const contact = safetyService.updateContact(req.actor!, req.params.id, req.body);
    res.json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
});

safetyRouter.delete('/emergency-circle/contacts/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    safetyService.revokeContact(req.actor!, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

safetyRouter.put('/emergency-circle/contacts/:id/scopes/:level', (req: Request, res: Response, next: NextFunction) => {
  try {
    const level = req.params.level as SafetyIncidentLevel;
    const contact = safetyService.updateContactScope(req.actor!, req.params.id, {
      incident_level: level,
      notify_contact: Boolean(req.body.notify_contact),
      share_incident_type: Boolean(req.body.share_incident_type),
      share_vehicle_summary: Boolean(req.body.share_vehicle_summary),
      share_live_location: Boolean(req.body.share_live_location),
      share_assistance_status: Boolean(req.body.share_assistance_status),
      share_callback_number: Boolean(req.body.share_callback_number),
    });
    res.json({ success: true, data: contact });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/preferences', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: safetyService.getPreferences(req.actor!) });
  } catch (err) {
    next(err);
  }
});

safetyRouter.put('/preferences', (req: Request, res: Response, next: NextFunction) => {
  try {
    const preferences = safetyService.updatePreferences(req.actor!, req.body);
    res.json({ success: true, data: preferences });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/readiness', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: safetyService.getReadiness(req.actor!) });
  } catch (err) {
    next(err);
  }
});

// Sprint 16 — SOS Engine & Emergency Activation

safetyRouter.post('/sos/attempts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggregate = sosService.initiate(req.actor!, req.body || {});
    res.status(202).json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/sos/active', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: sosService.getActive(req.actor!) });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/sos/incidents', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    res.json({ success: true, data: sosService.getHistory(req.actor!, limit) });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/sos/incidents/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: sosService.getAggregateForOwner(req.actor!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

safetyRouter.post('/sos/incidents/:id/cancel', (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggregate = sosService.cancel(req.actor!, req.params.id, req.body?.reason);
    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

safetyRouter.post('/sos/incidents/:id/safety-check-response', (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggregate = sosService.respondSafetyCheck(
      req.actor!,
      req.params.id,
      req.body?.response as SosSafetyCheckResponse,
      req.body?.notes
    );
    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

safetyRouter.post('/sos/incidents/:id/close', (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggregate = sosService.close(req.actor!, req.params.id, req.body?.reason);
    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

safetyRouter.get('/sos/incidents/:id/trusted-contact-access', (req: Request, res: Response, next: NextFunction) => {
  try {
    const grants = trustedContactService.listOwnerIncidentGrants(req.actor!.user_id, req.params.id);
    res.json({ success: true, data: grants });
  } catch (err) {
    next(err);
  }
});

safetyRouter.post('/sos/incidents/:id/trusted-contact-access/revoke', (req: Request, res: Response, next: NextFunction) => {
  try {
    const revoked = trustedContactService.revokeOwnerIncidentGrants(req.actor!.user_id, req.params.id);
    res.json({ success: true, data: { revoked_grant_count: revoked } });
  } catch (err) {
    next(err);
  }
});

// No external-emergency-service dispatch endpoint and no trusted-contact token
// endpoint exist in Sprint 16. Provider dispatch, portal access and automatic
// escalation must remain explicit later-sprint capabilities.
