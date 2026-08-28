import {
  useEffect,
  useState
} from 'react'

import {
  Activity,
  ContactRound,
  Headphones,
  Users
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import {
  getRideArrivoSupportData
} from '../lib/ridearrivoSupport'

type Role =
  | 'employee'
  | 'support'
  | 'engineer'
  | 'manager'
  | 'hr'
  | 'legal'
  | 'operations'
  | 'finance'
  | 'marketing'
  | 'partnerships'
  | 'admin'

type Metric = {
  key:string
  label:string
  value:string
  hint:string
  icon:'support'|'rides'|'people'|'crm'
}

function rowsFrom(value:any):any[]{
  if(Array.isArray(value)){
    return value
  }

  if(!value || typeof value!=='object'){
    return []
  }

  for(const key of [
    'data',
    'items',
    'results',
    'tickets',
    'rides',
    'records'
  ]){
    if(Array.isArray(value[key])){
      return value[key]
    }
  }

  return []
}

function MetricIcon({
  kind
}:{
  kind:Metric['icon']
}){
  if(kind==='support'){
    return <Headphones/>
  }

  if(kind==='rides'){
    return <Activity/>
  }

  if(kind==='people'){
    return <Users/>
  }

  return <ContactRound/>
}

export function OverviewMetrics({
  role
}:{
  role:Role
}){
  const [metrics,setMetrics]=
    useState<Metric[]>([])

  const [loading,setLoading]=
    useState(true)

  useEffect(()=>{
    let cancelled=false

    async function load(){
      const next:Metric[]=[]

      /*
       * SUPPORT
       * Only roles that the Support Edge Function itself permits.
       */
      if(
        role==='support' ||
        role==='manager' ||
        role==='admin'
      ){
        const [
          ticketsResult,
          ridesResult
        ]=await Promise.allSettled([
          getRideArrivoSupportData(
            'tickets',
            {limit:100}
          ),

          getRideArrivoSupportData(
            'liveRides',
            {limit:100}
          )
        ])

        if(
          ticketsResult.status==='fulfilled'
        ){
          next.push({
            key:'support-records',
            label:'Support records',
            value:String(
              rowsFrom(
                ticketsResult.value
              ).length
            ),
            hint:'Live Support backend',
            icon:'support'
          })
        }

        if(
          ridesResult.status==='fulfilled'
        ){
          next.push({
            key:'live-rides',
            label:'Live rides',
            value:String(
              rowsFrom(
                ridesResult.value
              ).length
            ),
            hint:'Live Operations backend',
            icon:'rides'
          })
        }
      }

      /*
       * PEOPLE / HR
       * Count only real database rows visible through RLS.
       */
      if(
        supabase &&
        (
          role==='hr' ||
          role==='manager' ||
          role==='admin'
        )
      ){
        const employeeResult=
          await supabase
            .from('employee_profiles')
            .select(
              'id',
              {
                count:'exact',
                head:true
              }
            )
            .eq('active',true)

        if(!employeeResult.error){
          next.push({
            key:'employees',
            label:'Active employees',
            value:String(
              employeeResult.count ?? 0
            ),
            hint:'Approved workspace members',
            icon:'people'
          })
        }
      }

      /*
       * CRM
       * We deliberately show a real opportunity COUNT.
       * We do not invent a monetary pipeline total until
       * the exact production amount field/stage rules are
       * confirmed.
       */
      if(
        supabase &&
        (
          role==='manager' ||
          role==='admin'
        )
      ){
        const crmResult=
          await supabase
            .from('crm_opportunities')
            .select(
              'id',
              {
                count:'exact',
                head:true
              }
            )

        if(!crmResult.error){
          next.push({
            key:'crm-opportunities',
            label:'CRM opportunities',
            value:String(
              crmResult.count ?? 0
            ),
            hint:'Live CRM records',
            icon:'crm'
          })
        }
      }

      if(!cancelled){
        setMetrics(next)
        setLoading(false)
      }
    }

    void load()

    return ()=>{
      cancelled=true
    }
  },[role])

  if(loading){
    return (
      <div className="overviewMetricsState">
        Loading live workspace metrics…
      </div>
    )
  }

  if(!metrics.length){
    return (
      <div className="overviewMetricsState">
        No company-wide metrics are assigned to your role.
        Your departmental and personal information is
        available from the workspaces you are authorised
        to use.
      </div>
    )
  }

  return (
    <div className="stats">
      {metrics.map(metric=>(
        <div
          className="metric"
          key={metric.key}
        >
          <div className="metricIcon">
            <MetricIcon
              kind={metric.icon}
            />
          </div>

          <span>
            {metric.label}
          </span>

          <strong>
            {metric.value}
          </strong>

          <small>
            {metric.hint}
          </small>
        </div>
      ))}
    </div>
  )
}
