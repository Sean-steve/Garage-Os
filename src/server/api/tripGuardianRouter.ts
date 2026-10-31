import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { tripGuardianService } from '../tripGuardian/tripGuardianService';
import { TripGuardianCheckInResponse } from '../tripGuardian/types';

export const tripGuardianRouter=Router();
tripGuardianRouter.use(authenticate());

tripGuardianRouter.get('/trip-guardian/journeys',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const vehicleId=typeof req.query.vehicle_id==='string'?req.query.vehicle_id:undefined;
    res.canonicalSuccess({journeys:tripGuardianService.list(req.actor!,vehicleId)});
  }catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(tripGuardianService.create(req.actor!,req.body||{}));
  }catch(err){next(err);}
});

tripGuardianRouter.get('/trip-guardian/journeys/:id',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.get(req.actor!,req.params.id));}
  catch(err){next(err);}
});

tripGuardianRouter.patch('/trip-guardian/journeys/:id',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.update(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

tripGuardianRouter.get('/trip-guardian/journeys/:id/readiness',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.getReadiness(req.actor!,req.params.id));}
  catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/start',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.start(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/arrive',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.arrive(req.actor!,req.params.id));}
  catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/cancel',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(tripGuardianService.cancel(req.actor!,req.params.id,req.body?.reason));}
  catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/location',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(tripGuardianService.recordLocation(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/checkins/:checkinId/respond',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(tripGuardianService.respondCheckIn(
      req.actor!,req.params.id,req.params.checkinId,
      req.body?.response as TripGuardianCheckInResponse,
      req.body?.notes
    ));
  }catch(err){next(err);}
});

tripGuardianRouter.post('/trip-guardian/journeys/:id/escalate/sos',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(202).canonicalSuccess(tripGuardianService.escalateToSos(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});
