import { Route } from 'lucide-react'
import { DataWorkbench } from './DataWorkbench'
import OperationsReceiptsPanel from './OperationsReceiptsPanel'

export default function OperationsControlPanel(){
  return (
    <div className="operationsControlPanel">
      <OperationsReceiptsPanel/>

      <div className="grid2">
        <DataWorkbench
          table="incidents"
          title="Incident register"
          orderBy="occurred_at"
          description="Safety, service and operational exceptions."
          createLabel="New incident"
          fields={[
            {key:'reference',label:'Reference',required:true},
            {key:'severity',label:'Severity',type:'select',options:['low','medium','high','critical'],required:true},
            {key:'category',label:'Category',required:true},
            {key:'summary',label:'Summary',type:'textarea',required:true},
            {key:'status',label:'Status',required:true},
          ]}
          columns={[
            {key:'reference',label:'Reference'},
            {key:'severity',label:'Severity'},
            {key:'category',label:'Category'},
            {key:'summary',label:'Summary'},
            {key:'status',label:'Status'},
          ]}
        />

        <DataWorkbench
          table="operations_driver_shifts"
          title="Driver shifts"
          orderBy="shift_date"
          description="Driver coverage, vehicle assignment and shift readiness."
          createLabel="Plan shift"
          fields={[
            {key:'driver_name',label:'Driver',required:true},
            {key:'shift_date',label:'Shift date',type:'date',required:true},
            {key:'start_time',label:'Start time',type:'time'},
            {key:'end_time',label:'End time',type:'time'},
            {key:'vehicle_reference',label:'Vehicle reference'},
            {key:'status',label:'Status',type:'select',options:['planned','confirmed','active','completed','cancelled'],required:true},
            {key:'notes',label:'Notes',type:'textarea'},
          ]}
          columns={[
            {key:'shift_date',label:'Date'},
            {key:'driver_name',label:'Driver'},
            {key:'vehicle_reference',label:'Vehicle'},
            {key:'status',label:'Status'},
          ]}
        />

        <DataWorkbench
          table="operations_fleet_maintenance"
          title="Fleet maintenance"
          description="Preventive maintenance, due work, vendors and cost control."
          createLabel="Schedule maintenance"
          fields={[
            {key:'vehicle_reference',label:'Vehicle',required:true},
            {key:'maintenance_type',label:'Maintenance type',required:true},
            {key:'due_date',label:'Due date',type:'date'},
            {key:'odometer_due',label:'Odometer due',type:'number'},
            {key:'status',label:'Status',type:'select',options:['scheduled','due','in_service','complete','overdue'],required:true},
            {key:'vendor',label:'Vendor'},
            {key:'cost',label:'Cost (NGN)',type:'number'},
            {key:'notes',label:'Notes',type:'textarea'},
          ]}
          columns={[
            {key:'vehicle_reference',label:'Vehicle'},
            {key:'maintenance_type',label:'Maintenance'},
            {key:'due_date',label:'Due'},
            {key:'status',label:'Status'},
            {key:'cost',label:'Cost'},
          ]}
        />

        <DataWorkbench
          table="operations_vehicle_inspections"
          title="Vehicle inspections"
          orderBy="inspection_date"
          description="Readiness inspections, defects and follow-up control."
          createLabel="Record inspection"
          fields={[
            {key:'vehicle_reference',label:'Vehicle',required:true},
            {key:'inspection_date',label:'Inspection date',type:'date',required:true},
            {key:'inspector',label:'Inspector',required:true},
            {key:'overall_status',label:'Result',type:'select',options:['pass','attention','fail'],required:true},
            {key:'defects',label:'Defects / observations',type:'textarea'},
            {key:'follow_up_due',label:'Follow-up due',type:'date'},
          ]}
          columns={[
            {key:'inspection_date',label:'Date'},
            {key:'vehicle_reference',label:'Vehicle'},
            {key:'inspector',label:'Inspector'},
            {key:'overall_status',label:'Result'},
            {key:'follow_up_due',label:'Follow-up'},
          ]}
        />

        <DataWorkbench
          table="operations_flight_watch"
          title="Airport flight watch"
          description="Flight arrival monitoring tied to airport-pickup execution."
          createLabel="Watch flight"
          fields={[
            {key:'booking_reference',label:'Booking reference'},
            {key:'flight_number',label:'Flight number',required:true},
            {key:'airline',label:'Airline'},
            {key:'scheduled_arrival',label:'Scheduled arrival',type:'datetime-local'},
            {key:'terminal',label:'Terminal'},
            {key:'status',label:'Status',required:true},
            {key:'notes',label:'Notes',type:'textarea'},
          ]}
          columns={[
            {key:'flight_number',label:'Flight'},
            {key:'booking_reference',label:'Booking'},
            {key:'airline',label:'Airline'},
            {key:'scheduled_arrival',label:'Arrival'},
            {key:'status',label:'Status'},
          ]}
        />

        <div className="glassCard feature">
          <Route/>
          <h3>Live dispatch integration</h3>
          <p>
            Live booking, vehicle and driver-position data remains sourced from
            RideArrivo operational APIs. These controls add readiness,
            maintenance, airport and exception management without creating a
            duplicate dispatch system.
          </p>
        </div>
      </div>
    </div>
  )
}
