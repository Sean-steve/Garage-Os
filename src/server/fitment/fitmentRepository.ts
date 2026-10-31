import { getDatabase } from '../database/connection';
import {
  FitmentDecision,
  FitmentInstallationLink,
  FitmentSource,
  ProductFitmentRule,
} from './types';

function rowSource(r:any):FitmentSource{
  return {
    id:String(r.id),source_type:r.source_type,display_name:String(r.display_name),
    owner_organization_id:r.owner_organization_id?String(r.owner_organization_id):null,
    provider_key:r.provider_key?String(r.provider_key):null,
    verification_authority:Boolean(r.verification_authority),
    trust_rank:Number(r.trust_rank),status:r.status,
    created_at:String(r.created_at),updated_at:String(r.updated_at),
  };
}

function rowRule(r:any):ProductFitmentRule{
  return {
    id:String(r.id),product_id:String(r.product_id),
    source_id:r.source_id?String(r.source_id):null,source_type:r.source_type,
    rule_kind:r.rule_kind,
    vehicle_make:r.vehicle_make?String(r.vehicle_make):null,
    vehicle_model:r.vehicle_model?String(r.vehicle_model):null,
    year_from:r.year_from===null||r.year_from===undefined?null:Number(r.year_from),
    year_to:r.year_to===null||r.year_to===undefined?null:Number(r.year_to),
    trim:r.trim?String(r.trim):null,variant:r.variant?String(r.variant):null,
    body_type:r.body_type?String(r.body_type):null,engine_type:r.engine_type?String(r.engine_type):null,
    fuel_type:r.fuel_type?String(r.fuel_type):null,transmission:r.transmission?String(r.transmission):null,
    drive_type:r.drive_type?String(r.drive_type):null,
    evidence_reference:r.evidence_reference?String(r.evidence_reference):null,
    evidence_summary:r.evidence_summary?String(r.evidence_summary):null,
    verification_status:r.verification_status,status:r.status,created_by:String(r.created_by),
    created_at:String(r.created_at),updated_at:String(r.updated_at),
    source_display_name:r.source_display_name?String(r.source_display_name):null,
    source_verification_authority:Boolean(r.source_verification_authority),
    source_trust_rank:r.source_trust_rank===null||r.source_trust_rank===undefined?null:Number(r.source_trust_rank),
  };
}

export class FitmentRepository {
  createSource(source:FitmentSource):FitmentSource{
    getDatabase().prepare(`
      INSERT INTO marketplace_fitment_sources
      (id,source_type,display_name,owner_organization_id,provider_key,verification_authority,trust_rank,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      source.id,source.source_type,source.display_name,source.owner_organization_id,source.provider_key,
      source.verification_authority?1:0,source.trust_rank,source.status,source.created_at,source.updated_at
    );
    return source;
  }

  getSource(id:string):FitmentSource|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_fitment_sources WHERE id=? LIMIT 1').get(id) as any;
    return r?rowSource(r):null;
  }

  listSources():FitmentSource[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_fitment_sources ORDER BY trust_rank DESC,display_name'
    ).all() as any[]).map(rowSource);
  }

  createRule(rule:ProductFitmentRule):ProductFitmentRule{
    getDatabase().prepare(`
      INSERT INTO marketplace_product_fitment_rules
      (id,product_id,source_id,source_type,rule_kind,vehicle_make,vehicle_model,year_from,year_to,
       trim,variant,body_type,engine_type,fuel_type,transmission,drive_type,evidence_reference,
       evidence_summary,verification_status,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      rule.id,rule.product_id,rule.source_id,rule.source_type,rule.rule_kind,rule.vehicle_make,
      rule.vehicle_model,rule.year_from,rule.year_to,rule.trim,rule.variant,rule.body_type,
      rule.engine_type,rule.fuel_type,rule.transmission,rule.drive_type,rule.evidence_reference,
      rule.evidence_summary,rule.verification_status,rule.status,rule.created_by,rule.created_at,rule.updated_at
    );
    return this.getRule(rule.id)!;
  }

  getRule(id:string):ProductFitmentRule|null{
    const r=getDatabase().prepare(`
      SELECT r.*,s.display_name AS source_display_name,
        COALESCE(s.verification_authority,0) AS source_verification_authority,
        s.trust_rank AS source_trust_rank
      FROM marketplace_product_fitment_rules r
      LEFT JOIN marketplace_fitment_sources s ON s.id=r.source_id
      WHERE r.id=? LIMIT 1
    `).get(id) as any;
    return r?rowRule(r):null;
  }

  listRulesForProduct(productId:string,includeRevoked=false):ProductFitmentRule[]{
    const sql=`
      SELECT r.*,s.display_name AS source_display_name,
        COALESCE(s.verification_authority,0) AS source_verification_authority,
        s.trust_rank AS source_trust_rank
      FROM marketplace_product_fitment_rules r
      LEFT JOIN marketplace_fitment_sources s ON s.id=r.source_id
      WHERE r.product_id=? ${includeRevoked?'':"AND r.status='ACTIVE'"}
        AND (s.id IS NULL OR s.status='ACTIVE' OR r.status='REVOKED')
      ORDER BY r.created_at ASC,r.id ASC
    `;
    return (getDatabase().prepare(sql).all(productId) as any[]).map(rowRule);
  }

  revokeRule(id:string,updatedAt:string):boolean{
    const r=getDatabase().prepare(
      "UPDATE marketplace_product_fitment_rules SET status='REVOKED',updated_at=? WHERE id=? AND status='ACTIVE'"
    ).run(updatedAt,id);
    return Number(r.changes||0)===1;
  }

  saveDecision(decision:FitmentDecision):FitmentDecision{
    if(!decision.id)return decision;
    getDatabase().prepare(`
      INSERT INTO marketplace_fitment_decisions
      (id,product_id,listing_id,vehicle_id,decision_status,confidence,matched_rule_ids_json,
       conflict_rule_ids_json,engine_version,guaranteed,decision_reason,evaluated_by,evaluated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      decision.id,decision.product_id,decision.listing_id,decision.vehicle_id,decision.status,
      decision.confidence,JSON.stringify(decision.matched_rule_ids),JSON.stringify(decision.conflict_rule_ids),
      decision.engine_version,0,decision.reason,'GARAGE_OS_FITMENT_ENGINE',decision.evaluated_at
    );
    return decision;
  }

  createInstallation(link:FitmentInstallationLink):FitmentInstallationLink{
    getDatabase().prepare(`
      INSERT INTO marketplace_fitment_installations
      (id,vehicle_id,product_id,listing_id,vehicle_component_id,fitment_decision_id,
       fitment_status_at_install,installation_source,verification_status,notes,recorded_by,installed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      link.id,link.vehicle_id,link.product_id,link.listing_id,link.vehicle_component_id,
      link.fitment_decision_id,link.fitment_status_at_install,link.installation_source,
      link.verification_status,link.notes,link.recorded_by,link.installed_at,link.created_at
    );
    return link;
  }

  listInstallations(vehicleId:string):FitmentInstallationLink[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_fitment_installations WHERE vehicle_id=? ORDER BY installed_at DESC,created_at DESC'
    ).all(vehicleId) as any[]).map((r:any)=>({
      id:String(r.id),vehicle_id:String(r.vehicle_id),product_id:String(r.product_id),
      listing_id:r.listing_id?String(r.listing_id):null,
      vehicle_component_id:r.vehicle_component_id?String(r.vehicle_component_id):null,
      fitment_decision_id:r.fitment_decision_id?String(r.fitment_decision_id):null,
      fitment_status_at_install:r.fitment_status_at_install,
      installation_source:r.installation_source,verification_status:r.verification_status,
      notes:r.notes?String(r.notes):null,recorded_by:String(r.recorded_by),
      installed_at:String(r.installed_at),created_at:String(r.created_at)
    }));
  }
}

export const fitmentRepository=new FitmentRepository();
