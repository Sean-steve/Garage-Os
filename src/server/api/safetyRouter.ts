import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { safetyService } from '../safety/safetyService';
import { SafetyIncidentLevel } from '../safety/types';

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

// Deliberately no /activate, /sos, /notify or trusted-contact access-token endpoints in Sprint 15.
// Those capabilities belong to Sprint 16/17 and must not be represented as operational before then.
