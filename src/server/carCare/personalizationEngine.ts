import {
  PersonalizedCarePlan,
  PersonalizedCareRecommendation,
  VehicleCareProfile,
} from './types';

export const CAR_CARE_PERSONALIZATION_RULE_VERSION = 'GAR020-S20-RULES-1';

export interface PersonalizationVehicleInput {
  vehicle_id: string;
  model_year: number;
  fuel_type: string;
  current_odometer_km: number;
}

export interface PersonalizationMaintenanceInput {
  overall_status: string;
  overdue_count: number;
  due_count: number;
  approaching_count: number;
}

export interface PersonalizationIssueInput {
  active_count: number;
  persistent_count: number;
  critical_count: number;
}

export interface PersonalizationTyreInput {
  installed_count: number;
  latest_inspections: Array<{
    id: string;
    condition_rating: string;
    observed_at: string;
  }>;
}

export interface PersonalizationFuelInput {
  anomaly_detected: boolean;
  observation_text: string | null;
  data_quality: string | null;
  snapshot_id: string | null;
}

export interface PersonalizationEngineInput {
  generated_at: string;
  vehicle: PersonalizationVehicleInput;
  profile: VehicleCareProfile | null;
  maintenance: PersonalizationMaintenanceInput;
  issues: PersonalizationIssueInput;
  tyres: PersonalizationTyreInput;
  fuel: PersonalizationFuelInput;
}

const action=(label:string,target_tab:'maintenance'|'issues'|'roadside'|'bookings'|'providers'|'care',article_slug?:string)=>({
  label,target_tab,article_slug
});

function addRecommendation(
  list:PersonalizedCareRecommendation[],
  value:Omit<PersonalizedCareRecommendation,'is_diagnosis'|'changes_maintenance_schedule'|'rule_version'>
):void{
  list.push({
    ...value,
    is_diagnosis:false,
    changes_maintenance_schedule:false,
    rule_version:CAR_CARE_PERSONALIZATION_RULE_VERSION,
  });
}

export function evaluatePersonalizedCare(input:PersonalizationEngineInput):PersonalizedCarePlan{
  const recs:PersonalizedCareRecommendation[]=[];
  const missionCodes=new Set<string>();
  const notes:string[]=[];
  const year=new Date(input.generated_at).getUTCFullYear();
  const vehicleAge=Math.max(0,year-input.vehicle.model_year);
  const profile=input.profile;

  if(!profile){
    addRecommendation(recs,{
      id:'personalization:profile',
      rule_id:'PROFILE_NOT_CONFIGURED',
      priority:'INFO',
      title:'Complete your care profile',
      explanation:'Garage OS can tailor routine care guidance when you explicitly provide usage, road, parking and environmental context. No location is inferred.',
      evidence:[{source_type:'VEHICLE_SPEC',label:'Vehicle model year',value:input.vehicle.model_year}],
      actions:[action('Configure care profile','care')]
    });
    notes.push('Owner care profile is not configured; personalization uses recorded vehicle evidence only.');
  }

  if(vehicleAge>=10){
    addRecommendation(recs,{
      id:'personalization:vehicle-age',
      rule_id:'VEHICLE_AGE_REVIEW_10Y',
      priority:'INFO',
      title:'Age-aware condition review',
      explanation:'This vehicle is at least 10 years old. Age can make condition and service history more important, but age alone does not prove any component is worn or defective.',
      evidence:[
        {source_type:'VEHICLE_SPEC',label:'Model year',value:input.vehicle.model_year},
        {source_type:'VEHICLE_SPEC',label:'Calculated vehicle age (years)',value:vehicleAge},
      ],
      actions:[action('Review maintenance','maintenance'),action('Book inspection if condition is uncertain','bookings')]
    });
  }

  if(input.vehicle.current_odometer_km>=150000){
    addRecommendation(recs,{
      id:'personalization:high-odometer',
      rule_id:'HIGH_ODOMETER_REVIEW_150K',
      priority:'INFO',
      title:'High-mileage care review',
      explanation:'Recorded mileage is above 150,000 km. Garage OS is recommending a history and condition review, not shortening the canonical maintenance schedule or predicting failure.',
      evidence:[{source_type:'ODOMETER',label:'Current odometer (km)',value:input.vehicle.current_odometer_km}],
      actions:[action('Review maintenance history','maintenance'),action('Review known issues','issues')]
    });
  }

  if(profile?.road_exposure==='ROUGH_ROADS_FREQUENT'){
    missionCodes.add('WEEKLY_OWNER_CHECK');
    addRecommendation(recs,{
      id:'personalization:rough-roads',
      rule_id:'ROUGH_ROAD_OWNER_CHECK',
      priority:'MEDIUM',
      title:'Frequent rough-road exposure',
      explanation:'You reported frequent rough-road driving. Give tyres, wheels and suspension-related symptoms extra owner attention, while keeping manufacturer/service intervals authoritative.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Road exposure',value:profile.road_exposure,source_reference_id:profile.id}],
      actions:[action('Start weekly owner check','care'),action('Review tyre/component records','care'),action('Record a symptom if present','issues')]
    });
  } else if(profile?.road_exposure==='MIXED'){
    missionCodes.add('WEEKLY_OWNER_CHECK');
    addRecommendation(recs,{
      id:'personalization:mixed-roads',
      rule_id:'MIXED_ROAD_ROUTINE_CHECK',
      priority:'INFO',
      title:'Mixed-road routine checks',
      explanation:'Your reported driving includes mixed road surfaces. Routine tyre and visible-condition checks may be useful; this does not alter maintenance due dates.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Road exposure',value:profile.road_exposure,source_reference_id:profile.id}],
      actions:[action('Start owner care check','care')]
    });
  }

  if(profile?.climate_exposures.includes('DUSTY')){
    addRecommendation(recs,{
      id:'personalization:dust',
      rule_id:'DUST_EXPOSURE_REVIEW',
      priority:'INFO',
      title:'Dust exposure care',
      explanation:'You reported dusty operating conditions. Review the vehicle manufacturer/service guidance for filters and inspect owner-safe visible areas more often; Garage OS does not automatically shorten maintenance intervals.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Environmental exposure',value:'DUSTY',source_reference_id:profile.id}],
      actions:[action('Review maintenance','maintenance'),action('Find service if inspection is needed','providers')]
    });
  }

  if(profile?.climate_exposures.includes('HOT')){
    addRecommendation(recs,{
      id:'personalization:heat',
      rule_id:'HOT_CONDITIONS_REVIEW',
      priority:'INFO',
      title:'Hot-condition care',
      explanation:'You reported frequent hot conditions. Pay attention to cooling-system warnings and battery/charging symptoms, but do not infer a defect from climate exposure alone.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Environmental exposure',value:'HOT',source_reference_id:profile.id}],
      actions:[action('Review overheating guidance','care','engine-temperature-overheating'),action('Record warning or symptom','issues')]
    });
  }

  if(profile?.climate_exposures.includes('HEAVY_RAIN')){
    missionCodes.add('PRE_TRIP_CHECK');
    addRecommendation(recs,{
      id:'personalization:rain',
      rule_id:'HEAVY_RAIN_VISIBILITY_TYRES',
      priority:'INFO',
      title:'Heavy-rain readiness',
      explanation:'You reported regular heavy-rain exposure. Prioritize tyre condition, exterior lights, wipers and visibility checks before travel.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Environmental exposure',value:'HEAVY_RAIN',source_reference_id:profile.id}],
      actions:[action('Start pre-trip check','care'),action('Review tyre-pressure guidance','care','tyre-pressure-warning')]
    });
  }

  if(profile?.climate_exposures.includes('COASTAL_SALT')){
    addRecommendation(recs,{
      id:'personalization:coastal',
      rule_id:'COASTAL_SALT_VISUAL_REVIEW',
      priority:'INFO',
      title:'Salt/corrosion exposure awareness',
      explanation:'You reported coastal/salt exposure. Periodic cleaning and professional condition review may be appropriate where corrosion is visible; exposure alone does not mean corrosion is present.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Environmental exposure',value:'COASTAL_SALT',source_reference_id:profile.id}],
      actions:[action('Find care/service provider','providers'),action('Record visible concern','issues')]
    });
  }

  if(profile?.parking_context==='OUTDOOR_EXPOSED'){
    addRecommendation(recs,{
      id:'personalization:outdoor-parking',
      rule_id:'OUTDOOR_EXPOSURE_OWNER_CHECK',
      priority:'INFO',
      title:'Outdoor-exposure checks',
      explanation:'You reported exposed outdoor parking. Routine owner checks can focus on wipers, visible tyres, lights and body/glass condition without treating exposure as a defect.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Parking context',value:profile.parking_context,source_reference_id:profile.id}],
      actions:[action('Start owner care check','care')]
    });
  }

  if(profile && (
    profile.usage_pattern==='LONG_DISTANCE' ||
    profile.long_trip_frequency==='MONTHLY' ||
    profile.long_trip_frequency==='FREQUENT'
  )){
    missionCodes.add('LONG_TRIP_PREPARATION');
    addRecommendation(recs,{
      id:'personalization:long-trip',
      rule_id:'FREQUENT_LONG_TRIP_PREPARATION',
      priority:'MEDIUM',
      title:'Long-distance preparation cadence',
      explanation:'Your owner-configured profile indicates regular long-distance travel. Use the long-trip mission before major journeys and resolve known safety/maintenance concerns through their owning workflows.',
      evidence:[
        {source_type:'OWNER_PROFILE',label:'Usage pattern',value:profile.usage_pattern,source_reference_id:profile.id},
        {source_type:'OWNER_PROFILE',label:'Long-trip frequency',value:profile.long_trip_frequency,source_reference_id:profile.id},
        {source_type:'MAINTENANCE_STATE',label:'Maintenance overall state',value:input.maintenance.overall_status},
        {source_type:'VEHICLE_ISSUE',label:'Active issue count',value:input.issues.active_count},
      ],
      actions:[action('Start long-trip preparation','care'),action('Review maintenance','maintenance'),action('Review issues','issues')]
    });
  }

  if(profile?.heavy_load_frequency==='FREQUENT'){
    addRecommendation(recs,{
      id:'personalization:load',
      rule_id:'FREQUENT_LOAD_CARE',
      priority:'MEDIUM',
      title:'Frequent load-use care',
      explanation:'You reported frequent heavy-load use. Stay within the vehicle manufacturer load limits and give tyre, braking and suspension symptoms prompt attention. This does not alter component ratings or maintenance intervals.',
      evidence:[{source_type:'OWNER_PROFILE',label:'Heavy-load frequency',value:profile.heavy_load_frequency,source_reference_id:profile.id}],
      actions:[action('Review tyre records','care'),action('Record braking/handling symptoms','issues'),action('Book inspection if uncertain','bookings')]
    });
  }

  const criticalTyre=input.tyres.latest_inspections.find(x=>x.condition_rating==='CRITICAL');
  const poorTyre=input.tyres.latest_inspections.find(x=>x.condition_rating==='POOR');
  if(criticalTyre){
    addRecommendation(recs,{
      id:'personalization:tyre-critical',
      rule_id:'RECORDED_TYRE_CRITICAL',
      priority:'CRITICAL',
      title:'Critical tyre condition is already recorded',
      explanation:'A tyre inspection record is marked CRITICAL. This is an existing inspection state, not a new Car Care diagnosis. Review the tyre record and arrange appropriate professional assistance before relying on routine owner checks.',
      evidence:[{
        source_type:'TYRE_INSPECTION',label:'Latest tyre condition',value:criticalTyre.condition_rating,
        source_reference_id:criticalTyre.id
      }],
      actions:[action('Review tyre guidance','care','tyre-pressure-warning'),action('Find professional service','providers'),action('Open roadside if vehicle should not be driven','roadside')]
    });
  }else if(poorTyre){
    addRecommendation(recs,{
      id:'personalization:tyre-poor',
      rule_id:'RECORDED_TYRE_POOR',
      priority:'HIGH',
      title:'Poor tyre condition is already recorded',
      explanation:'A tyre inspection record is marked POOR. Car Care is surfacing that recorded condition without predicting the cause or remaining tyre life.',
      evidence:[{
        source_type:'TYRE_INSPECTION',label:'Latest tyre condition',value:poorTyre.condition_rating,
        source_reference_id:poorTyre.id
      }],
      actions:[action('Review tyre guidance','care','tyre-pressure-warning'),action('Book tyre inspection/service','bookings')]
    });
  }else if(input.tyres.installed_count>0 && input.tyres.latest_inspections.length===0){
    notes.push('Installed tyre records exist but no tyre inspection records were available for personalization.');
  }

  if(input.fuel.anomaly_detected){
    addRecommendation(recs,{
      id:'personalization:fuel-anomaly',
      rule_id:'RECORDED_FUEL_EFFICIENCY_ANOMALY',
      priority:'MEDIUM',
      title:'Fuel-efficiency change has been observed',
      explanation:(input.fuel.observation_text
        ? input.fuel.observation_text+' '
        : 'The fuel domain recorded an efficiency anomaly. ')+
        'This is an observation, not a diagnosis of any engine, tyre or fuel-system fault.',
      evidence:[{
        source_type:'FUEL_EFFICIENCY',label:'Fuel anomaly recorded',value:true,
        source_reference_id:input.fuel.snapshot_id||undefined
      },{
        source_type:'FUEL_EFFICIENCY',label:'Data quality',value:input.fuel.data_quality
      }],
      actions:[action('Review fuel data','care'),action('Record related symptoms if present','issues'),action('Book diagnostic inspection if needed','bookings')]
    });
  }

  if(input.issues.critical_count>0){
    notes.push('Critical issue records remain authoritative and take precedence over routine personalization.');
  }
  if(input.maintenance.overdue_count>0){
    notes.push('Overdue maintenance remains authoritative; personalization does not change its due-state.');
  }

  const rank={CRITICAL:0,HIGH:1,MEDIUM:2,INFO:3};
  recs.sort((a,b)=>rank[a.priority]-rank[b.priority]||a.rule_id.localeCompare(b.rule_id));

  const configuredFields=profile?[
    profile.usage_pattern!=='UNKNOWN',
    profile.annual_distance_band!=='UNKNOWN',
    profile.road_exposure!=='UNKNOWN',
    profile.parking_context!=='UNKNOWN',
    profile.climate_exposures.length>0,
    profile.long_trip_frequency!=='UNKNOWN',
    profile.heavy_load_frequency!=='UNKNOWN'
  ].filter(Boolean).length:0;

  const profileCompleteness=!profile?'NOT_CONFIGURED':configuredFields>=6?'CONFIGURED':'PARTIAL';

  return {
    vehicle_id:input.vehicle.vehicle_id,
    generated_at:input.generated_at,
    rule_version:CAR_CARE_PERSONALIZATION_RULE_VERSION,
    profile,
    profile_completeness:profileCompleteness,
    recommendations:recs.slice(0,15),
    recommended_mission_codes:Array.from(missionCodes),
    data_quality_notes:notes,
    safety_statement:'Personalized Car Care is deterministic guidance based only on recorded vehicle data and owner-configured context. It does not diagnose faults, infer hidden location, or change canonical maintenance schedules.',
    location_inference_used:false,
    ai_inference_used:false,
  };
}
