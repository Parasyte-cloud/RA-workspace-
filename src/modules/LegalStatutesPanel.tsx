import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  BookOpenCheck,
  FilePlus2,
  Search,
} from 'lucide-react'

import {
  createLegalStatute,
  legalErrorMessage,
  loadLegalStatutes,
  updateLegalStatute,
} from '../lib/legalLawReports'

import type {
  LegalRisk,
  LegalStatute,
  NewLegalStatute,
} from '../lib/legalLawReports'

type Props={
  canManage:boolean
}

type Draft={
  title:string
  instrument_type:string
  regulator:string
  jurisdiction:string
  reference_number:string
  commencement_date:string
  status:
    | 'proposed'
    | 'in_force'
    | 'amended'
    | 'repealed'
    | 'superseded'
  summary:string
  key_provisions:string
  ridearrivo_impact:string
  required_action:string
  risk_rating:LegalRisk
  source_url:string
}

const emptyDraft:Draft={
  title:'',
  instrument_type:'act',
  regulator:'',
  jurisdiction:'Nigeria',
  reference_number:'',
  commencement_date:'',
  status:'in_force',
  summary:'',
  key_provisions:'',
  ridearrivo_impact:'',
  required_action:'',
  risk_rating:'low',
  source_url:'',
}

function label(value:string){
  const formatted=
    value.replace(/_/g,' ')

  return formatted.charAt(0).toUpperCase()+
    formatted.slice(1)
}

function dateLabel(value:string|null){
  if(!value) return 'Not recorded'

  return new Intl.DateTimeFormat(
    'en-NG',
    {
      day:'numeric',
      month:'short',
      year:'numeric',
    }
  ).format(
    new Date(`${value}T12:00:00`)
  )
}

function toDraft(
  item:LegalStatute
):Draft{
  return {
    title:item.title,
    instrument_type:item.instrument_type,
    regulator:item.regulator || '',
    jurisdiction:item.jurisdiction,
    reference_number:
      item.reference_number || '',
    commencement_date:
      item.commencement_date || '',
    status:item.status,
    summary:item.summary || '',
    key_provisions:
      item.key_provisions || '',
    ridearrivo_impact:
      item.ridearrivo_impact || '',
    required_action:
      item.required_action || '',
    risk_rating:item.risk_rating,
    source_url:item.source_url || '',
  }
}

function payload(
  draft:Draft
):NewLegalStatute{
  return {
    title:draft.title,
    instrument_type:
      draft.instrument_type,
    regulator:draft.regulator,
    jurisdiction:draft.jurisdiction,
    reference_number:
      draft.reference_number,
    commencement_date:
      draft.commencement_date,
    status:draft.status,
    summary:draft.summary,
    key_provisions:
      draft.key_provisions,
    ridearrivo_impact:
      draft.ridearrivo_impact,
    required_action:
      draft.required_action,
    risk_rating:
      draft.risk_rating,
    source_url:
      draft.source_url,
  }
}

export default function LegalStatutesPanel({
  canManage,
}:Props){
  const [items,setItems]=
    useState<LegalStatute[]>([])

  const [selected,setSelected]=
    useState<LegalStatute|null>(null)

  const [creating,setCreating]=
    useState(false)

  const [editingId,setEditingId]=
    useState<string|null>(null)

  const [draft,setDraft]=
    useState<Draft>(emptyDraft)

  const [search,setSearch]=
    useState('')

  const [statusFilter,setStatusFilter]=
    useState('all')

  const [riskFilter,setRiskFilter]=
    useState('all')

  const [loading,setLoading]=
    useState(true)

  const [saving,setSaving]=
    useState(false)

  const [message,setMessage]=
    useState('')

  const reload=async()=>{
    try{
      setLoading(true)
      setMessage('')

      const next=
        await loadLegalStatutes()

      setItems(next)

      if(selected){
        setSelected(
          next.find(
            item=>item.id===selected.id
          ) || null
        )
      }
    }catch(error){
      setMessage(
        legalErrorMessage(error)
      )
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{
    void reload()
  },[])

  const filtered=
    useMemo(()=>{
      const query=
        search.trim().toLowerCase()

      return items.filter(item=>{
        const matchesSearch=
          !query ||
          [
            item.title,
            item.regulator,
            item.reference_number,
            item.jurisdiction,
            item.instrument_type,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query)

        const matchesStatus=
          statusFilter==='all' ||
          item.status===statusFilter

        const matchesRisk=
          riskFilter==='all' ||
          item.risk_rating===riskFilter

        return (
          matchesSearch &&
          matchesStatus &&
          matchesRisk
        )
      })
    },[
      items,
      search,
      statusFilter,
      riskFilter,
    ])

  const openNew=()=>{
    setSelected(null)
    setEditingId(null)
    setDraft(emptyDraft)
    setCreating(true)
  }

  const openEdit=(
    item:LegalStatute
  )=>{
    setSelected(null)
    setCreating(false)
    setEditingId(item.id)
    setDraft(toDraft(item))
  }

  const cancel=()=>{
    setCreating(false)
    setEditingId(null)
    setDraft(emptyDraft)
  }

  const save=async()=>{
    if(
      !draft.title.trim() ||
      !draft.instrument_type.trim()
    ){
      setMessage(
        'Instrument title and type are required.'
      )
      return
    }

    try{
      setSaving(true)
      setMessage('')

      const saved=
        editingId
          ? await updateLegalStatute(
              editingId,
              payload(draft)
            )
          : await createLegalStatute(
              payload(draft)
            )

      setCreating(false)
      setEditingId(null)
      setDraft(emptyDraft)
      setSelected(saved)

      await reload()
    }catch(error){
      setMessage(
        legalErrorMessage(error)
      )
    }finally{
      setSaving(false)
    }
  }

  return (
    <div className="legalReportsShell">
      <div className="legalReportsNav">
        <div>
          <span className="eyebrow">
            LEGAL AUTHORITIES
          </span>

          <h3>Statutes & Regulations</h3>

          <p>
            Primary legislation, regulations,
            regulatory instruments and their
            operational impact on RideArrivo.
          </p>
        </div>

        {canManage&&(
          <button
            className="primaryButton"
            onClick={openNew}
          >
            <FilePlus2 size={17}/>
            Add instrument
          </button>
        )}
      </div>

      {message&&(
        <div className="moduleNotice">
          {message}
        </div>
      )}

      {loading&&(
        <div className="glassCard legalLoading">
          Loading statutes and regulations…
        </div>
      )}

      {!loading&&
        (creating || editingId!==null)&&
        canManage&&(
          <div className="glassCard lawReportEditor">
            <div className="lawReportEditorHead">
              <div>
                <span className="eyebrow">
                  {editingId
                    ? 'EDIT LEGAL INSTRUMENT'
                    : 'NEW LEGAL INSTRUMENT'}
                </span>

                <h3>
                  {editingId
                    ? 'Update statute or regulation'
                    : 'Record statute or regulation'}
                </h3>
              </div>

              <button
                className="glassButton"
                onClick={cancel}
              >
                Cancel
              </button>
            </div>

            <div className="lawReportFormGrid">
              <label>
                Instrument title
                <input
                  value={draft.title}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      title:event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Instrument type
                <select
                  value={draft.instrument_type}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      instrument_type:
                        event.target.value,
                    })
                  }
                >
                  <option value="act">Act</option>
                  <option value="law">Law</option>
                  <option value="regulation">
                    Regulation
                  </option>
                  <option value="rule">Rule</option>
                  <option value="guideline">
                    Guideline
                  </option>
                  <option value="circular">
                    Circular
                  </option>
                  <option value="notice">
                    Notice
                  </option>
                  <option value="order">
                    Order
                  </option>
                  <option value="directive">
                    Directive
                  </option>
                  <option value="gazette">
                    Gazette
                  </option>
                  <option value="other">
                    Other
                  </option>
                </select>
              </label>

              <label>
                Regulator / issuing authority
                <input
                  value={draft.regulator}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      regulator:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Jurisdiction
                <input
                  value={draft.jurisdiction}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      jurisdiction:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Reference number
                <input
                  value={draft.reference_number}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      reference_number:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Commencement date
                <input
                  type="date"
                  value={draft.commencement_date}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      commencement_date:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Legal status
                <select
                  value={draft.status}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      status:event.target.value as Draft['status'],
                    })
                  }
                >
                  <option value="proposed">
                    Proposed
                  </option>
                  <option value="in_force">
                    In force
                  </option>
                  <option value="amended">
                    Amended
                  </option>
                  <option value="repealed">
                    Repealed
                  </option>
                  <option value="superseded">
                    Superseded
                  </option>
                </select>
              </label>

              <label>
                Risk rating
                <select
                  value={draft.risk_rating}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      risk_rating:event.target.value as LegalRisk,
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">
                    Medium
                  </option>
                  <option value="high">High</option>
                  <option value="critical">
                    Critical
                  </option>
                </select>
              </label>

              <label className="wide">
                Summary
                <textarea
                  rows={4}
                  value={draft.summary}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      summary:event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Key provisions
                <textarea
                  rows={5}
                  value={draft.key_provisions}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      key_provisions:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                RideArrivo impact
                <textarea
                  rows={4}
                  value={draft.ridearrivo_impact}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      ridearrivo_impact:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Required action
                <textarea
                  rows={4}
                  value={draft.required_action}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      required_action:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Official source URL
                <input
                  type="url"
                  value={draft.source_url}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      source_url:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="buttonRow">
              <button
                className="primaryButton"
                disabled={saving}
                onClick={()=>void save()}
              >
                {saving
                  ? 'Saving…'
                  : editingId
                    ? 'Save changes'
                    : 'Save draft'}
              </button>
            </div>
          </div>
        )}

      {!loading&&
        !creating&&
        editingId===null&&
        !selected&&(
          <div className="glassCard legalReportRegister">
            <div className="legalReportFilters">
              <label>
                <Search size={16}/>
                <input
                  placeholder="Search laws, regulators or references"
                  value={search}
                  onChange={event=>
                    setSearch(event.target.value)
                  }
                />
              </label>

              <select
                value={statusFilter}
                onChange={event=>
                  setStatusFilter(
                    event.target.value
                  )
                }
              >
                <option value="all">
                  All statuses
                </option>
                <option value="proposed">
                  Proposed
                </option>
                <option value="in_force">
                  In force
                </option>
                <option value="amended">
                  Amended
                </option>
                <option value="repealed">
                  Repealed
                </option>
                <option value="superseded">
                  Superseded
                </option>
              </select>

              <select
                value={riskFilter}
                onChange={event=>
                  setRiskFilter(
                    event.target.value
                  )
                }
              >
                <option value="all">
                  All risks
                </option>
                <option value="low">Low</option>
                <option value="medium">
                  Medium
                </option>
                <option value="high">
                  High
                </option>
                <option value="critical">
                  Critical
                </option>
              </select>
            </div>

            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Authority</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Commencement</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(item=>(
                    <tr key={item.id}>
                      <td>
                        <strong>
                          {item.title}
                        </strong>
                      </td>

                      <td>
                        {item.regulator || '—'}
                      </td>

                      <td>
                        {label(
                          item.instrument_type
                        )}
                      </td>

                      <td>
                        {label(item.status)}
                      </td>

                      <td>
                        {label(
                          item.risk_rating
                        )}
                      </td>

                      <td>
                        {dateLabel(
                          item.commencement_date
                        )}
                      </td>

                      <td>
                        <button
                          className="glassButton"
                          onClick={()=>
                            setSelected(item)
                          }
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!filtered.length&&(
                    <tr>
                      <td colSpan={7}>
                        No statutes or regulations
                        match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {!loading&&selected&&(
        <article className="glassCard lawReportReader">
          <div className="lawReportReaderHead">
            <div>
              <span className="eyebrow">
                {label(selected.instrument_type)}
              </span>

              <h2>{selected.title}</h2>

              <p>
                {selected.regulator ||
                  selected.jurisdiction}
              </p>
            </div>

            <div className="buttonRow">
              <button
                className="glassButton"
                onClick={()=>
                  setSelected(null)
                }
              >
                Back
              </button>

              {canManage&&(
                <button
                  className="glassButton"
                  onClick={()=>
                    openEdit(selected)
                  }
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          <div className="lawReportMeta">
            <span>
              <strong>Status</strong>
              {label(selected.status)}
            </span>

            <span>
              <strong>Risk</strong>
              {label(
                selected.risk_rating
              )}
            </span>

            <span>
              <strong>Jurisdiction</strong>
              {selected.jurisdiction}
            </span>

            <span>
              <strong>Reference</strong>
              {selected.reference_number ||
                'Not recorded'}
            </span>

            <span>
              <strong>Commencement</strong>
              {dateLabel(
                selected.commencement_date
              )}
            </span>
          </div>

          <div className="lawReportBody">
            <section className="lawReportSection">
              <h4>Summary</h4>
              <p>
                {selected.summary ||
                  'Not recorded.'}
              </p>
            </section>

            <section className="lawReportSection">
              <h4>Key Provisions</h4>
              <p>
                {selected.key_provisions ||
                  'Not recorded.'}
              </p>
            </section>

            <section className="lawReportSection">
              <h4>RideArrivo Impact</h4>
              <p>
                {selected.ridearrivo_impact ||
                  'Not recorded.'}
              </p>
            </section>

            <section className="lawReportSection">
              <h4>Required Action</h4>
              <p>
                {selected.required_action ||
                  'Not recorded.'}
              </p>
            </section>
          </div>

          <div className="lawReportSources">
            <BookOpenCheck size={18}/>
            <h4>Authority Source</h4>

            {selected.source_url ? (
              <a
                href={selected.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Open official source
              </a>
            ) : (
              <span>
                No official source URL recorded.
              </span>
            )}
          </div>
        </article>
      )}
    </div>
  )
}
