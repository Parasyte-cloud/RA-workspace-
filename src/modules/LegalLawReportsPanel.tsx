import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  BookOpen,
  CheckCircle2,
  FilePlus2,
  Gavel,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'

import {
  createLawReport,
  legalErrorMessage,
  loadLawReports,
  loadLegalWorkspaceRole,
  transitionLawReport,
  updateLawReport,
} from '../lib/legalLawReports'

import type {
  LegalConfidentiality,
  LegalLawReport,
  LegalRisk,
  LegalVerificationStatus,
  NewLawReport,
} from '../lib/legalLawReports'

import LegalStatutesPanel from './LegalStatutesPanel'
import LegalResearchOpinionsPanel from './LegalResearchOpinionsPanel'

import '../legal-law-reports.css'

type Tab =
  | 'overview'
  | 'reports'
  | 'statutes'
  | 'opinions'
  | 'review'

type Draft = {
  report_title:string
  case_name:string
  citation:string
  neutral_citation:string
  court:string
  jurisdiction:string
  decision_date:string
  judges:string
  practice_areas:string
  material_facts:string
  issues_for_determination:string
  parties_arguments:string
  statutes_considered:string
  authorities_considered:string
  holding:string
  ratio_decidendi:string
  obiter_dicta:string
  orders_made:string
  legal_principle:string
  appeal_status:string
  ridearrivo_relevance:string
  operational_impact:string
  recommendation:string
  risk_rating:LegalRisk
  source_url:string
  secondary_source_url:string
  confidentiality:LegalConfidentiality
}

const emptyDraft:Draft={
  report_title:'',
  case_name:'',
  citation:'',
  neutral_citation:'',
  court:'',
  jurisdiction:'Nigeria',
  decision_date:'',
  judges:'',
  practice_areas:'',
  material_facts:'',
  issues_for_determination:'',
  parties_arguments:'',
  statutes_considered:'',
  authorities_considered:'',
  holding:'',
  ratio_decidendi:'',
  obiter_dicta:'',
  orders_made:'',
  legal_principle:'',
  appeal_status:'',
  ridearrivo_relevance:'',
  operational_impact:'',
  recommendation:'',
  risk_rating:'low',
  source_url:'',
  secondary_source_url:'',
  confidentiality:'internal',
}

function csv(value:string){
  return value
    .split(',')
    .map(item=>item.trim())
    .filter(Boolean)
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

function dateTimeLabel(value:string|null){
  if(!value) return 'Not recorded'

  return new Intl.DateTimeFormat(
    'en-NG',
    {
      day:'numeric',
      month:'short',
      year:'numeric',
      hour:'2-digit',
      minute:'2-digit',
    }
  ).format(new Date(value))
}

function statusLabel(
  value:LegalVerificationStatus
){
  return value
    .replace(/_/g,' ')
    .replace(
      /\b\w/g,
      (character:string)=>character.toUpperCase()
    )
}

function reportToDraft(
  report:LegalLawReport
):Draft{
  return {
    report_title:report.report_title,
    case_name:report.case_name,
    citation:report.citation || '',
    neutral_citation:
      report.neutral_citation || '',
    court:report.court,
    jurisdiction:report.jurisdiction,
    decision_date:
      report.decision_date || '',
    judges:
      report.judges.join(', '),
    practice_areas:
      report.practice_areas.join(', '),
    material_facts:
      report.material_facts || '',
    issues_for_determination:
      report.issues_for_determination || '',
    parties_arguments:
      report.parties_arguments || '',
    statutes_considered:
      report.statutes_considered || '',
    authorities_considered:
      report.authorities_considered || '',
    holding:
      report.holding || '',
    ratio_decidendi:
      report.ratio_decidendi || '',
    obiter_dicta:
      report.obiter_dicta || '',
    orders_made:
      report.orders_made || '',
    legal_principle:
      report.legal_principle || '',
    appeal_status:
      report.appeal_status || '',
    ridearrivo_relevance:
      report.ridearrivo_relevance || '',
    operational_impact:
      report.operational_impact || '',
    recommendation:
      report.recommendation || '',
    risk_rating:report.risk_rating,
    source_url:
      report.source_url || '',
    secondary_source_url:
      report.secondary_source_url || '',
    confidentiality:
      report.confidentiality,
  }
}

function draftPayload(
  draft:Draft
):NewLawReport{
  return {
    report_title:draft.report_title,
    case_name:draft.case_name,
    citation:draft.citation,
    neutral_citation:
      draft.neutral_citation,
    court:draft.court,
    jurisdiction:draft.jurisdiction,
    decision_date:
      draft.decision_date,
    judges:csv(draft.judges),
    practice_areas:
      csv(draft.practice_areas),
    material_facts:
      draft.material_facts,
    issues_for_determination:
      draft.issues_for_determination,
    parties_arguments:
      draft.parties_arguments,
    statutes_considered:
      draft.statutes_considered,
    authorities_considered:
      draft.authorities_considered,
    holding:draft.holding,
    ratio_decidendi:
      draft.ratio_decidendi,
    obiter_dicta:
      draft.obiter_dicta,
    orders_made:
      draft.orders_made,
    legal_principle:
      draft.legal_principle,
    appeal_status:
      draft.appeal_status,
    ridearrivo_relevance:
      draft.ridearrivo_relevance,
    operational_impact:
      draft.operational_impact,
    recommendation:
      draft.recommendation,
    risk_rating:
      draft.risk_rating,
    source_url:
      draft.source_url,
    secondary_source_url:
      draft.secondary_source_url,
    confidentiality:
      draft.confidentiality,
  }
}

function Section({
  title,
  value,
}:{
  title:string
  value:string|null
}){
  return (
    <section className="lawReportSection">
      <h4>{title}</h4>
      <p>{value || 'Not recorded.'}</p>
    </section>
  )
}

export default function LegalLawReportsPanel(){
  const [tab,setTab]=
    useState<Tab>('overview')

  const [reports,setReports]=
    useState<LegalLawReport[]>([])

  const [selected,setSelected]=
    useState<LegalLawReport|null>(null)

  const [editingId,setEditingId]=
    useState<string|null>(null)

  const [creating,setCreating]=
    useState(false)

  const [draft,setDraft]=
    useState<Draft>(emptyDraft)

  const [role,setRole]=
    useState<string|null>(null)

  const [search,setSearch]=
    useState('')

  const [risk,setRisk]=
    useState('all')

  const [status,setStatus]=
    useState('all')

  const [loading,setLoading]=
    useState(true)

  const [saving,setSaving]=
    useState(false)

  const [message,setMessage]=
    useState('')

  const canManage=
    role==='legal' ||
    role==='admin'

  const reload=async()=>{
    try{
      setLoading(true)
      setMessage('')

      const [
        nextRole,
        nextReports,
      ]=await Promise.all([
        loadLegalWorkspaceRole(),
        loadLawReports(),
      ])

      setRole(nextRole)
      setReports(nextReports)

      if(selected){
        const nextSelected=
          nextReports.find(
            report=>report.id===selected.id
          ) || null

        setSelected(nextSelected)
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

      return reports.filter(report=>{
        const matchesSearch=
          !query ||
          [
            report.report_title,
            report.case_name,
            report.citation,
            report.neutral_citation,
            report.court,
            report.jurisdiction,
            ...report.practice_areas,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query)

        const matchesRisk=
          risk==='all' ||
          report.risk_rating===risk

        const matchesStatus=
          status==='all' ||
          report.verification_status===status

        return (
          matchesSearch &&
          matchesRisk &&
          matchesStatus
        )
      })
    },[
      reports,
      risk,
      search,
      status,
    ])

  const reviewQueue=
    reports.filter(
      report=>
        report.verification_status===
          'source_verified' ||
        report.verification_status===
          'reviewed'
    )

  const approved=
    reports.filter(
      report=>
        report.verification_status===
        'approved'
    ).length

  const critical=
    reports.filter(
      report=>
        report.risk_rating==='critical' ||
        report.risk_rating==='high'
    ).length

  const draftCount=
    reports.filter(
      report=>
        report.verification_status===
        'draft'
    ).length

  const openNew=()=>{
    setEditingId(null)
    setCreating(true)
    setDraft(emptyDraft)
    setSelected(null)
    setTab('reports')
  }

  const openEdit=(
    report:LegalLawReport
  )=>{
    setSelected(null)
    setCreating(false)
    setEditingId(report.id)
    setDraft(reportToDraft(report))
    setTab('reports')
  }

  const cancelEditor=()=>{
    setCreating(false)
    setEditingId(null)
    setDraft(emptyDraft)
  }

  const saveReport=async()=>{
    if(
      !draft.report_title.trim() ||
      !draft.case_name.trim() ||
      !draft.court.trim()
    ){
      setMessage(
        'Report title, case name and court are required.'
      )
      return
    }

    try{
      setSaving(true)
      setMessage('')

      const saved=
        editingId
          ? await updateLawReport(
              editingId,
              draftPayload(draft)
            )
          : await createLawReport(
              draftPayload(draft)
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

  const changeStatus=async(
    report:LegalLawReport,
    next:LegalVerificationStatus
  )=>{
    const confirmed=
      window.confirm(
        `Move "${report.report_title}" to ${statusLabel(next)}?`
      )

    if(!confirmed) return

    try{
      setMessage('')

      const updated=
        await transitionLawReport(
          report.id,
          next
        )

      setSelected(updated)
      await reload()
    }catch(error){
      setMessage(
        legalErrorMessage(error)
      )
    }
  }

  const nextAction=(
    report:LegalLawReport
  )=>{
    if(
      report.verification_status===
      'draft'
    ){
      return {
        label:'Mark source verified',
        status:
          'source_verified' as const,
      }
    }

    if(
      report.verification_status===
      'source_verified'
    ){
      return {
        label:'Mark reviewed',
        status:'reviewed' as const,
      }
    }

    if(
      report.verification_status===
      'reviewed'
    ){
      return {
        label:'Approve report',
        status:'approved' as const,
      }
    }

    return null
  }

  return (
    <div className="legalReportsShell">
      <div className="legalReportsNav">
        <div>
          <span className="eyebrow">
            LEGAL INTELLIGENCE
          </span>
          <h3>Law Reports</h3>
          <p>
            Verified case law, legal principles,
            authorities and internal impact analysis.
          </p>
        </div>

        <div className="legalReportsTabs">
          <button
            className={
              tab==='overview'
                ? 'active'
                : ''
            }
            onClick={()=>setTab('overview')}
          >
            Overview
          </button>

          <button
            className={
              tab==='reports'
                ? 'active'
                : ''
            }
            onClick={()=>setTab('reports')}
          >
            Case Reports
          </button>

          <button
            className={
              tab==='statutes'
                ? 'active'
                : ''
            }
            onClick={()=>setTab('statutes')}
          >
            Statutes & Regulations
          </button>

          <button
            className={
              tab==='opinions'
                ? 'active'
                : ''
            }
            onClick={()=>setTab('opinions')}
          >
            Research Opinions
          </button>

          <button
            className={
              tab==='review'
                ? 'active'
                : ''
            }
            onClick={()=>setTab('review')}
          >
            Review Queue
          </button>
        </div>

        {canManage&&(
          <button
            className="primaryButton"
            onClick={openNew}
          >
            <FilePlus2 size={17}/>
            New law report
          </button>
        )}
      </div>

      {message&&(
        <div className="moduleNotice">
          {message}
        </div>
      )}

      {loading ? (
        <div className="glassCard legalLoading">
          Loading Legal intelligence…
        </div>
      ) : null}

      {!loading&&tab==='overview'&&(
        <>
          <div className="legalReportStats">
            <div className="glassCard">
              <BookOpen/>
              <span>Total reports</span>
              <strong>{reports.length}</strong>
            </div>

            <div className="glassCard">
              <ShieldCheck/>
              <span>Approved</span>
              <strong>{approved}</strong>
            </div>

            <div className="glassCard">
              <Gavel/>
              <span>Awaiting review</span>
              <strong>{reviewQueue.length}</strong>
            </div>

            <div className="glassCard">
              <TriangleAlert/>
              <span>High / critical risk</span>
              <strong>{critical}</strong>
            </div>
          </div>

          <div className="grid2">
            <div className="glassCard legalOverviewCard">
              <h3>Research control</h3>

              <div className="legalControlList">
                <span>
                  <strong>{draftCount}</strong>
                  Draft reports
                </span>

                <span>
                  <strong>
                    {reviewQueue.length}
                  </strong>
                  Reports in verification/review
                </span>

                <span>
                  <strong>{approved}</strong>
                  Approved authorities
                </span>
              </div>
            </div>

            <div className="glassCard legalOverviewCard">
              <h3>Legal reporting standard</h3>

              <p>
                Reports progress through Draft,
                Source Verified, Reviewed and Approved.
                Approved legal substance is preserved
                and cannot be silently overwritten.
              </p>
            </div>
          </div>
        </>
      )}

      {!loading&&tab==='reports'&&(
        <>
          {(creating || editingId!==null)&&canManage ? (
            <div className="glassCard lawReportEditor">
              <div className="lawReportEditorHead">
                <div>
                  <span className="eyebrow">
                    {editingId
                      ? 'EDIT CASE REPORT'
                      : 'NEW CASE REPORT'}
                  </span>

                  <h3>
                    {editingId
                      ? 'Update law report'
                      : 'Prepare law report'}
                  </h3>
                </div>

                <button
                  className="glassButton"
                  onClick={cancelEditor}
                >
                  Cancel
                </button>
              </div>

              <div className="lawReportFormGrid">
                <label>
                  Report title
                  <input
                    value={draft.report_title}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        report_title:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Case name
                  <input
                    value={draft.case_name}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        case_name:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Citation
                  <input
                    value={draft.citation}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        citation:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Neutral citation
                  <input
                    value={draft.neutral_citation}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        neutral_citation:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Court
                  <input
                    value={draft.court}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        court:
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
                  Decision date
                  <input
                    type="date"
                    value={draft.decision_date}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        decision_date:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Risk
                  <select
                    value={draft.risk_rating}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        risk_rating:
                          event.target.value as LegalRisk,
                      })
                    }
                  >
                    <option value="low">
                      Low
                    </option>
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
                </label>

                <label>
                  Confidentiality
                  <select
                    value={draft.confidentiality}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        confidentiality:
                          event.target.value as LegalConfidentiality,
                      })
                    }
                  >
                    <option value="internal">
                      Internal
                    </option>
                    <option value="privileged">
                      Privileged
                    </option>
                  </select>
                </label>

                <label>
                  Judges
                  <input
                    placeholder="Comma separated"
                    value={draft.judges}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        judges:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label className="wide">
                  Practice areas
                  <input
                    placeholder="e.g. Employment, Privacy, Commercial"
                    value={draft.practice_areas}
                    onChange={event=>
                      setDraft({
                        ...draft,
                        practice_areas:
                          event.target.value,
                      })
                    }
                  />
                </label>

                {[
                  ['material_facts','Material facts'],
                  ['issues_for_determination','Issues for determination'],
                  ['parties_arguments','Arguments / positions of the parties'],
                  ['statutes_considered','Statutes and regulations considered'],
                  ['authorities_considered','Authorities considered'],
                  ['holding','Decision / holding'],
                  ['ratio_decidendi','Ratio decidendi'],
                  ['obiter_dicta','Obiter dicta'],
                  ['orders_made','Orders made'],
                  ['legal_principle','Legal principle established'],
                  ['appeal_status','Current / appeal status'],
                  ['ridearrivo_relevance','Relevance to RideArrivo'],
                  ['operational_impact','Operational / compliance impact'],
                  ['recommendation','Recommended action'],
                ].map(([key,label])=>(
                  <label
                    className="wide"
                    key={key}
                  >
                    {label}
                    <textarea
                      rows={4}
                      value={
                        draft[
                          key as keyof Draft
                        ] as string
                      }
                      onChange={event=>
                        setDraft({
                          ...draft,
                          [key]:
                            event.target.value,
                        })
                      }
                    />
                  </label>
                ))}

                <label className="wide">
                  Primary / official source URL
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

                <label className="wide">
                  Secondary source URL
                  <input
                    type="url"
                    value={
                      draft.secondary_source_url
                    }
                    onChange={event=>
                      setDraft({
                        ...draft,
                        secondary_source_url:
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
                  onClick={()=>
                    void saveReport()
                  }
                >
                  {saving
                    ? 'Saving…'
                    : editingId
                      ? 'Save changes'
                      : 'Save draft'}
                </button>
              </div>
            </div>
          ) : null}

          {!selected&&editingId===null&&(
            <div className="glassCard legalReportRegister">
              <div className="legalReportFilters">
                <label>
                  <Search size={16}/>
                  <input
                    placeholder="Search cases, citations, courts or practice areas"
                    value={search}
                    onChange={event=>
                      setSearch(
                        event.target.value
                      )
                    }
                  />
                </label>

                <select
                  value={risk}
                  onChange={event=>
                    setRisk(
                      event.target.value
                    )
                  }
                >
                  <option value="all">
                    All risks
                  </option>
                  <option value="low">
                    Low
                  </option>
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

                <select
                  value={status}
                  onChange={event=>
                    setStatus(
                      event.target.value
                    )
                  }
                >
                  <option value="all">
                    All statuses
                  </option>
                  <option value="draft">
                    Draft
                  </option>
                  <option value="source_verified">
                    Source verified
                  </option>
                  <option value="reviewed">
                    Reviewed
                  </option>
                  <option value="approved">
                    Approved
                  </option>
                  <option value="superseded">
                    Superseded
                  </option>
                  <option value="archived">
                    Archived
                  </option>
                </select>
              </div>

              <div className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Citation</th>
                      <th>Court</th>
                      <th>Status</th>
                      <th>Risk</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>

                  <tbody>
                    {filtered.map(report=>(
                      <tr key={report.id}>
                        <td>
                          <strong>
                            {report.case_name}
                          </strong>
                        </td>

                        <td>
                          {report.citation || '—'}
                        </td>

                        <td>{report.court}</td>

                        <td>
                          {statusLabel(
                            report.verification_status
                          )}
                        </td>

                        <td>
                          {report.risk_rating}
                        </td>

                        <td>
                          {dateTimeLabel(
                            report.updated_at
                          )}
                        </td>

                        <td>
                          <button
                            className="glassButton"
                            onClick={()=>
                              setSelected(report)
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
                          No law reports match
                          these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selected&&(
            <article className="glassCard lawReportReader">
              <div className="lawReportReaderHead">
                <div>
                  <span className="eyebrow">
                    {statusLabel(
                      selected.verification_status
                    )}
                  </span>

                  <h2>{selected.case_name}</h2>

                  <p>
                    {selected.citation ||
                      selected.neutral_citation ||
                      'Citation not recorded'}
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

                  {canManage&&
                    ![
                      'approved',
                      'superseded',
                      'archived',
                    ].includes(
                      selected.verification_status
                    )&&(
                      <button
                        className="glassButton"
                        onClick={()=>
                          openEdit(selected)
                        }
                      >
                        Edit
                      </button>
                    )}

                  {canManage&&
                    nextAction(selected)&&(
                      <button
                        className="primaryButton"
                        onClick={()=>{
                          const action=
                            nextAction(selected)

                          if(action){
                            void changeStatus(
                              selected,
                              action.status
                            )
                          }
                        }}
                      >
                        <CheckCircle2 size={16}/>
                        {
                          nextAction(selected)
                            ?.label
                        }
                      </button>
                    )}
                </div>
              </div>

              <div className="lawReportMeta">
                <span>
                  <strong>Court</strong>
                  {selected.court}
                </span>

                <span>
                  <strong>Jurisdiction</strong>
                  {selected.jurisdiction}
                </span>

                <span>
                  <strong>Decision</strong>
                  {dateLabel(
                    selected.decision_date
                  )}
                </span>

                <span>
                  <strong>Risk</strong>
                  {selected.risk_rating}
                </span>

                <span>
                  <strong>Confidentiality</strong>
                  {selected.confidentiality}
                </span>
              </div>

              <div className="lawReportBody">
                <Section
                  title="Material Facts"
                  value={
                    selected.material_facts
                  }
                />

                <Section
                  title="Issues for Determination"
                  value={
                    selected
                      .issues_for_determination
                  }
                />

                <Section
                  title="Arguments / Positions of the Parties"
                  value={
                    selected.parties_arguments
                  }
                />

                <Section
                  title="Applicable Statutes and Regulations"
                  value={
                    selected.statutes_considered
                  }
                />

                <Section
                  title="Authorities Considered"
                  value={
                    selected
                      .authorities_considered
                  }
                />

                <Section
                  title="Decision / Holding"
                  value={selected.holding}
                />

                <Section
                  title="Ratio Decidendi"
                  value={
                    selected.ratio_decidendi
                  }
                />

                <Section
                  title="Obiter Dicta"
                  value={
                    selected.obiter_dicta
                  }
                />

                <Section
                  title="Orders Made"
                  value={
                    selected.orders_made
                  }
                />

                <Section
                  title="Legal Principle Established"
                  value={
                    selected.legal_principle
                  }
                />

                <Section
                  title="Current / Appeal Status"
                  value={
                    selected.appeal_status
                  }
                />

                <Section
                  title="Relevance to RideArrivo"
                  value={
                    selected
                      .ridearrivo_relevance
                  }
                />

                <Section
                  title="Operational / Compliance Impact"
                  value={
                    selected
                      .operational_impact
                  }
                />

                <Section
                  title="Recommended Action"
                  value={
                    selected.recommendation
                  }
                />
              </div>

              <div className="lawReportSources">
                <h4>Sources</h4>

                {selected.source_url ? (
                  <a
                    href={selected.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Primary / official source
                  </a>
                ) : (
                  <span>
                    No primary source URL recorded.
                  </span>
                )}

                {selected.secondary_source_url&&(
                  <a
                    href={
                      selected.secondary_source_url
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Secondary source
                  </a>
                )}
              </div>
            </article>
          )}
        </>
      )}

      {!loading&&tab==='statutes'&&(
        <LegalStatutesPanel
          canManage={canManage}
        />
      )}

      {!loading&&tab==='opinions'&&(
        <LegalResearchOpinionsPanel
          canManage={canManage}
        />
      )}

      {!loading&&tab==='review'&&(
        <div className="glassCard legalReviewQueue">
          <div className="workbenchHead">
            <div>
              <h3>Verification & review queue</h3>
              <p>
                Reports awaiting legal review or
                approval.
              </p>
            </div>

            <Gavel/>
          </div>

          {reviewQueue.map(report=>{
            const action=
              nextAction(report)

            return (
              <div
                className="legalReviewItem"
                key={report.id}
              >
                <div>
                  <strong>
                    {report.case_name}
                  </strong>

                  <span>
                    {statusLabel(
                      report.verification_status
                    )}
                    {' · '}
                    {report.court}
                  </span>
                </div>

                <div className="buttonRow">
                  <button
                    className="glassButton"
                    onClick={()=>{
                      setSelected(report)
                      setTab('reports')
                    }}
                  >
                    Review report
                  </button>

                  {canManage&&action&&(
                    <button
                      className="primaryButton"
                      onClick={()=>
                        void changeStatus(
                          report,
                          action.status
                        )
                      }
                    >
                      {action.label}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {!reviewQueue.length&&(
            <div className="legalEmpty">
              <ShieldCheck size={26}/>
              <strong>
                Review queue is clear
              </strong>
              <span>
                No reports currently require
                verification or approval.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
