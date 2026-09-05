import { useState } from 'react'
import {
  Activity,
  CarFront,
  CircleDollarSign,
  Plane,
  Route,
  ShieldAlert,
  UsersRound,
} from 'lucide-react'

import { DataWorkbench } from './DataWorkbench'
import OperationsReceiptsPanel from './OperationsReceiptsPanel'

import '../arrivoops.css'


const views = [
  {
    id: 'overview',
    label: 'Overview',
    Icon: Activity,
  },
  {
    id: 'receipts',
    label: 'Receipts & Spend',
    Icon: CircleDollarSign,
  },
  {
    id: 'incidents',
    label: 'Incidents',
    Icon: ShieldAlert,
  },
  {
    id: 'drivers',
    label: 'Drivers & Shifts',
    Icon: UsersRound,
  },
  {
    id: 'fleet',
    label: 'Fleet & Inspections',
    Icon: CarFront,
  },
  {
    id: 'airport',
    label: 'Airport Operations',
    Icon: Plane,
  },
] as const


type ArrivoOpsView =
  typeof views[number]['id']


export default function OperationsControlPanel() {
  const [view, setView] =
    useState<ArrivoOpsView>('overview')

  return (
    <div className="operationsControlPanel arrivoOps">
      <section className="arrivoOpsHero glassCard">
        <div className="arrivoOpsHeroCopy">
          <span className="eyebrow">
            ARRIVOOPS
          </span>

          <h3>
            ArrivoOps Control Centre
          </h3>

          <p>
            One operational workspace for dispatch readiness,
            drivers, fleet, airport execution, incidents and
            governed operational spend.
          </p>
        </div>

        <div className="arrivoOpsSource">
          <span>
            LIVE OPERATIONS SOURCE
          </span>

          <strong>
            RideArrivo operational APIs
          </strong>

          <small>
            Bookings, active trips and driver-position data
            remain authoritative in the live operating platform.
          </small>
        </div>
      </section>

      <nav
        className="arrivoOpsTabs glassCard"
        aria-label="ArrivoOps sections"
      >
        {views.map((item) => {
          const Icon = item.Icon

          return (
            <button
              key={item.id}
              type="button"
              className={
                view === item.id
                  ? 'arrivoOpsTab active'
                  : 'arrivoOpsTab'
              }
              aria-pressed={view === item.id}
              onClick={() => setView(item.id)}
            >
              <Icon size={16}/>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {view === 'overview' && (
        <div className="arrivoOpsOverview">
          <div className="arrivoOpsQuickGrid">
            <article className="glassCard arrivoOpsQuickCard">
              <Route/>

              <div>
                <span className="eyebrow">
                  LIVE SERVICE
                </span>

                <h3>
                  Dispatch & Live Trips
                </h3>

                <p>
                  Booking allocation, trip execution,
                  driver positioning and live service
                  remain connected to RideArrivo's
                  operational backend.
                </p>
              </div>

              <a
                className="primaryButton arrivoOpsLaunch"
                href="https://admin.ridearrivo.com"
                target="_blank"
                rel="noreferrer"
              >
                Open live operations
              </a>
            </article>

            <article className="glassCard arrivoOpsQuickCard">
              <UsersRound/>

              <div>
                <span className="eyebrow">
                  DRIVERS
                </span>

                <h3>
                  Driver Readiness
                </h3>

                <p>
                  Plan driver shifts, vehicle assignments,
                  coverage and operating readiness.
                </p>
              </div>

              <button
                type="button"
                className="glassButton"
                onClick={() => setView('drivers')}
              >
                Open drivers
              </button>
            </article>

            <article className="glassCard arrivoOpsQuickCard">
              <CarFront/>

              <div>
                <span className="eyebrow">
                  FLEET
                </span>

                <h3>
                  Fleet Readiness
                </h3>

                <p>
                  Coordinate maintenance, inspections,
                  defects, downtime and vehicle readiness.
                </p>
              </div>

              <button
                type="button"
                className="glassButton"
                onClick={() => setView('fleet')}
              >
                Open fleet
              </button>
            </article>

            <article className="glassCard arrivoOpsQuickCard">
              <Plane/>

              <div>
                <span className="eyebrow">
                  AIRPORT
                </span>

                <h3>
                  Airport Execution
                </h3>

                <p>
                  Track flight arrivals and maintain the
                  operating context required for airport
                  pickup execution.
                </p>
              </div>

              <button
                type="button"
                className="glassButton"
                onClick={() => setView('airport')}
              >
                Open airport
              </button>
            </article>

            <article className="glassCard arrivoOpsQuickCard">
              <ShieldAlert/>

              <div>
                <span className="eyebrow">
                  SAFETY
                </span>

                <h3>
                  Incidents & Exceptions
                </h3>

                <p>
                  Capture safety, service and operational
                  exceptions with severity and resolution
                  status.
                </p>
              </div>

              <button
                type="button"
                className="glassButton"
                onClick={() => setView('incidents')}
              >
                Open incidents
              </button>
            </article>

            <article className="glassCard arrivoOpsQuickCard">
              <CircleDollarSign/>

              <div>
                <span className="eyebrow">
                  OPERATING SPEND
                </span>

                <h3>
                  Receipts & Spend
                </h3>

                <p>
                  Submit operating receipts while preserving
                  the existing Finance and Admin review and
                  audit controls.
                </p>
              </div>

              <button
                type="button"
                className="glassButton"
                onClick={() => setView('receipts')}
              >
                Open receipts
              </button>
            </article>
          </div>

          <div className="glassCard arrivoOpsPrinciple">
            <Route/>

            <div>
              <h3>
                One operating system, not a duplicate dispatch
              </h3>

              <p>
                ArrivoOps combines the existing RideArrivo
                operational controls inside the workstation.
                Live bookings, trips, vehicles and driver
                positions remain sourced from the operational
                APIs until those feeds are deliberately exposed
                natively inside this workspace.
              </p>
            </div>
          </div>
        </div>
      )}

      {view === 'receipts' && (
        <OperationsReceiptsPanel/>
      )}

      {view === 'incidents' && (
        <div className="arrivoOpsSingle">
          <DataWorkbench
            table="incidents"
            title="Incident register"
            orderBy="occurred_at"
            description="Safety, service and operational exceptions."
            createLabel="New incident"
            fields={[
              {
                key: 'reference',
                label: 'Reference',
                required: true,
              },
              {
                key: 'severity',
                label: 'Severity',
                type: 'select',
                options: [
                  'low',
                  'medium',
                  'high',
                  'critical',
                ],
                required: true,
              },
              {
                key: 'category',
                label: 'Category',
                required: true,
              },
              {
                key: 'summary',
                label: 'Summary',
                type: 'textarea',
                required: true,
              },
              {
                key: 'status',
                label: 'Status',
                required: true,
              },
            ]}
            columns={[
              {
                key: 'reference',
                label: 'Reference',
              },
              {
                key: 'severity',
                label: 'Severity',
              },
              {
                key: 'category',
                label: 'Category',
              },
              {
                key: 'summary',
                label: 'Summary',
              },
              {
                key: 'status',
                label: 'Status',
              },
            ]}
          />
        </div>
      )}

      {view === 'drivers' && (
        <div className="arrivoOpsSingle">
          <DataWorkbench
            table="operations_driver_shifts"
            title="Driver shifts"
            orderBy="shift_date"
            description="Driver coverage, vehicle assignment and shift readiness."
            createLabel="Plan shift"
            fields={[
              {
                key: 'driver_name',
                label: 'Driver',
                required: true,
              },
              {
                key: 'shift_date',
                label: 'Shift date',
                type: 'date',
                required: true,
              },
              {
                key: 'start_time',
                label: 'Start time',
                type: 'time',
              },
              {
                key: 'end_time',
                label: 'End time',
                type: 'time',
              },
              {
                key: 'vehicle_reference',
                label: 'Vehicle reference',
              },
              {
                key: 'status',
                label: 'Status',
                type: 'select',
                options: [
                  'planned',
                  'confirmed',
                  'active',
                  'completed',
                  'cancelled',
                ],
                required: true,
              },
              {
                key: 'notes',
                label: 'Notes',
                type: 'textarea',
              },
            ]}
            columns={[
              {
                key: 'shift_date',
                label: 'Date',
              },
              {
                key: 'driver_name',
                label: 'Driver',
              },
              {
                key: 'vehicle_reference',
                label: 'Vehicle',
              },
              {
                key: 'status',
                label: 'Status',
              },
            ]}
          />
        </div>
      )}

      {view === 'fleet' && (
        <div className="grid2 arrivoOpsFleetGrid">
          <DataWorkbench
            table="operations_fleet_maintenance"
            title="Fleet maintenance"
            description="Preventive maintenance, due work, vendors and cost control."
            createLabel="Schedule maintenance"
            fields={[
              {
                key: 'vehicle_reference',
                label: 'Vehicle',
                required: true,
              },
              {
                key: 'maintenance_type',
                label: 'Maintenance type',
                required: true,
              },
              {
                key: 'due_date',
                label: 'Due date',
                type: 'date',
              },
              {
                key: 'odometer_due',
                label: 'Odometer due',
                type: 'number',
              },
              {
                key: 'status',
                label: 'Status',
                type: 'select',
                options: [
                  'scheduled',
                  'due',
                  'in_service',
                  'complete',
                  'overdue',
                ],
                required: true,
              },
              {
                key: 'vendor',
                label: 'Vendor',
              },
              {
                key: 'cost',
                label: 'Cost (NGN)',
                type: 'number',
              },
              {
                key: 'notes',
                label: 'Notes',
                type: 'textarea',
              },
            ]}
            columns={[
              {
                key: 'vehicle_reference',
                label: 'Vehicle',
              },
              {
                key: 'maintenance_type',
                label: 'Maintenance',
              },
              {
                key: 'due_date',
                label: 'Due',
              },
              {
                key: 'status',
                label: 'Status',
              },
              {
                key: 'cost',
                label: 'Cost',
              },
            ]}
          />

          <DataWorkbench
            table="operations_vehicle_inspections"
            title="Vehicle inspections"
            orderBy="inspection_date"
            description="Readiness inspections, defects and follow-up control."
            createLabel="Record inspection"
            fields={[
              {
                key: 'vehicle_reference',
                label: 'Vehicle',
                required: true,
              },
              {
                key: 'inspection_date',
                label: 'Inspection date',
                type: 'date',
                required: true,
              },
              {
                key: 'inspector',
                label: 'Inspector',
                required: true,
              },
              {
                key: 'overall_status',
                label: 'Result',
                type: 'select',
                options: [
                  'pass',
                  'attention',
                  'fail',
                ],
                required: true,
              },
              {
                key: 'defects',
                label: 'Defects / observations',
                type: 'textarea',
              },
              {
                key: 'follow_up_due',
                label: 'Follow-up due',
                type: 'date',
              },
            ]}
            columns={[
              {
                key: 'inspection_date',
                label: 'Date',
              },
              {
                key: 'vehicle_reference',
                label: 'Vehicle',
              },
              {
                key: 'inspector',
                label: 'Inspector',
              },
              {
                key: 'overall_status',
                label: 'Result',
              },
              {
                key: 'follow_up_due',
                label: 'Follow-up',
              },
            ]}
          />
        </div>
      )}

      {view === 'airport' && (
        <div className="arrivoOpsSingle">
          <DataWorkbench
            table="operations_flight_watch"
            title="Airport flight watch"
            description="Flight arrival monitoring tied to airport-pickup execution."
            createLabel="Watch flight"
            fields={[
              {
                key: 'booking_reference',
                label: 'Booking reference',
              },
              {
                key: 'flight_number',
                label: 'Flight number',
                required: true,
              },
              {
                key: 'airline',
                label: 'Airline',
              },
              {
                key: 'scheduled_arrival',
                label: 'Scheduled arrival',
                type: 'datetime-local',
              },
              {
                key: 'terminal',
                label: 'Terminal',
              },
              {
                key: 'status',
                label: 'Status',
                required: true,
              },
              {
                key: 'notes',
                label: 'Notes',
                type: 'textarea',
              },
            ]}
            columns={[
              {
                key: 'flight_number',
                label: 'Flight',
              },
              {
                key: 'booking_reference',
                label: 'Booking',
              },
              {
                key: 'airline',
                label: 'Airline',
              },
              {
                key: 'scheduled_arrival',
                label: 'Arrival',
              },
              {
                key: 'status',
                label: 'Status',
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}
