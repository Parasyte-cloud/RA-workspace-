import { supabase } from './supabase'

export type LiveMetricSnapshot = {
  openBookings:number
  activeRides:number
  panicAlerts:number
  averageResponseMinutes:number

  crmContacts:number
  corporateAccounts:number
  crmPipelineValue:number
  followUpsDue:number

  activeEmployees:number
  leaveRequests:number
  onboardingPercent:number
  hrRequests:number
}

export const emptyLiveMetricSnapshot:LiveMetricSnapshot={
  openBookings:0,
  activeRides:0,
  panicAlerts:0,
  averageResponseMinutes:0,

  crmContacts:0,
  corporateAccounts:0,
  crmPipelineValue:0,
  followUpsDue:0,

  activeEmployees:0,
  leaveRequests:0,
  onboardingPercent:0,
  hrRequests:0
}

export async function getLiveMetricSnapshot():
  Promise<LiveMetricSnapshot>{

  /*
   * Production integration point.
   *
   * Do not call Render directly from the browser with
   * privileged credentials.
   *
   * The preferred architecture is:
   *
   * Workspace
   *   -> authenticated Supabase Edge Function
   *   -> RideArrivo Render backend
   *
   * Until that endpoint is connected, return zero-value
   * production-safe metrics.
   */

  if(!supabase){
    return emptyLiveMetricSnapshot
  }

  return emptyLiveMetricSnapshot
}
