import { Router, Request, Response, NextFunction } from 'express';
import { trustedContactService } from '../safety/trustedContactService';
import { TrustedContactResponse } from '../safety/types';

export const trustedContactRouter = Router();

function tokenFromRequest(req: Request): string {
  const token = req.header('x-trusted-contact-token');
  return token ? token.trim() : '';
}

function hardenPortalResponse(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

trustedContactRouter.get('/access', (req: Request, res: Response, next: NextFunction) => {
  try {
    hardenPortalResponse(res);
    const view = trustedContactService.resolvePortal(tokenFromRequest(req));
    res.json({ success: true, data: view });
  } catch (err) {
    next(err);
  }
});

trustedContactRouter.post('/response', (req: Request, res: Response, next: NextFunction) => {
  try {
    hardenPortalResponse(res);
    const view = trustedContactService.recordResponse(
      tokenFromRequest(req),
      req.body?.response as TrustedContactResponse
    );
    res.json({ success: true, data: view });
  } catch (err) {
    next(err);
  }
});
