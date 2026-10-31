import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { accidentService } from '../accident/accidentService';

export const accidentRouter = Router();
accidentRouter.use(authenticate());

accidentRouter.get('/accidents', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const vehicleId=typeof req.query.vehicle_id==='string'?req.query.vehicle_id:undefined;
    res.canonicalSuccess({accidents:accidentService.list(req.actor!,vehicleId)});
  }catch(err){next(err);}
});

accidentRouter.post('/accidents', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const data=accidentService.create(req.actor!,req.body||{});
    res.status(201).canonicalSuccess(data);
  }catch(err){next(err);}
});

accidentRouter.get('/accidents/:id', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(accidentService.get(req.actor!,req.params.id));}
  catch(err){next(err);}
});

accidentRouter.patch('/accidents/:id/draft', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(accidentService.updateDraft(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/finalize', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(accidentService.finalize(req.actor!,req.params.id));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/participants', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addParticipant(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/witnesses', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addWitness(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/damage-observations', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addDamage(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/evidence', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addEvidence(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/external-references', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addExternalReference(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/handoffs', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.linkHandoff(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/addenda', (req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(accidentService.addAddendum(req.actor!,req.params.id,req.body||{}));}
  catch(err){next(err);}
});

accidentRouter.post('/accidents/:id/close', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(accidentService.close(req.actor!,req.params.id,req.body?.reason));}
  catch(err){next(err);}
});
