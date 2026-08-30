import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  FilePlus2,
  LockKeyhole,
  Search,
  Scale,
} from 'lucide-react'

import {
  createLegalOpinion,
  legalErrorMessage,
  loadLegalOpinions,
  updateLegalOpinion,
} from '../lib/legalLawReports'

import type {
  LegalResearchOpinion,
  LegalRisk,
  NewLegalOpinion,
} from '../lib/legalLawReports'

type Props={
  canManage:boolean
}

type Draft={
  title:string
  question_presented:string
  background:string
  applicable_law:string
  authorities:string
  analysis:string
  conclusion:string
  recommendation:string
  risk_rating:LegalRisk
  privileged:boolean
}

const emptyDraft:Draft={
  title:'',
  question_presented:'',
  background:'',
  applicable_law:'',
  authorities:'',
  analysis:'',
  conclusion:'',
  recommendation:'',
  risk_rating:'low',
  privileged:true,
}

function label(value:string){
  const formatted=
    value.replace(/_/g,' ')

  return formatted.charAt(0).toUpperCase()+
    formatted.slice(1)
}

function toDraft(
  item:LegalResearchOpinion
):Draft{
  return {
    title:item.title,
    question_presented:
      item.question_presented,
    background:item.background || '',
    applicable_law:
      item.applicable_law || '',
    authorities:item.authorities || '',
    analysis:item.analysis || '',
    conclusion:item.conclusion || '',
    recommendation:
      item.recommendation || '',
    risk_rating:item.risk_rating,
    privileged:item.privileged,
  }
}

function payload(
  draft:Draft
):NewLegalOpinion{
  return {
    title:draft.title,
    question_presented:
      draft.question_presented,
    background:draft.background,
    applicable_law:
      draft.applicable_law,
    authorities:draft.authorities,
    analysis:draft.analysis,
    conclusion:draft.conclusion,
    recommendation:
      draft.recommendation,
    risk_rating:
      draft.risk_rating,
    privileged:
      draft.privileged,
  }
}

export default function LegalResearchOpinionsPanel({
  canManage,
}:Props){
  const [items,setItems]=
    useState<LegalResearchOpinion[]>([])

  const [selected,setSelected]=
    useState<LegalResearchOpinion|null>(null)

  const [creating,setCreating]=
    useState(false)

  const [editingId,setEditingId]=
    useState<string|null>(null)

  const [draft,setDraft]=
    useState<Draft>(emptyDraft)

  const [search,setSearch]=
    useState('')

  const [riskFilter,setRiskFilter]=
    useState('all')

  const [privilegeFilter,setPrivilegeFilter]=
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
        await loadLegalOpinions()

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
            item.question_presented,
            item.applicable_law,
            item.authorities,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query)

        const matchesRisk=
          riskFilter==='all' ||
          item.risk_rating===riskFilter

        const matchesPrivilege=
          privilegeFilter==='all' ||
          (
            privilegeFilter==='privileged'
              ? item.privileged
              : !item.privileged
          )

        return (
          matchesSearch &&
          matchesRisk &&
          matchesPrivilege
        )
      })
    },[
      items,
      search,
      riskFilter,
      privilegeFilter,
    ])

  const openNew=()=>{
    setSelected(null)
    setEditingId(null)
    setDraft(emptyDraft)
    setCreating(true)
  }

  const openEdit=(
    item:LegalResearchOpinion
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
      !draft.question_presented.trim()
    ){
      setMessage(
        'Opinion title and question presented are required.'
      )
      return
    }

    try{
      setSaving(true)
      setMessage('')

      const saved=
        editingId
          ? await updateLegalOpinion(
              editingId,
              payload(draft)
            )
          : await createLegalOpinion(
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
            LEGAL RESEARCH
          </span>

          <h3>Research Opinions</h3>

          <p>
            Internal legal research, analysis,
            authorities, conclusions and
            recommended legal positions.
          </p>
        </div>

        {canManage&&(
          <button
            className="primaryButton"
            onClick={openNew}
          >
            <FilePlus2 size={17}/>
            New legal opinion
          </button>
        )}
      </div>

      <div className="moduleNotice">
        <LockKeyhole size={16}/>
        Legal opinions default to privileged.
        Non-privileged opinions may be made
        available to authorised management.
      </div>

      {message&&(
        <div className="moduleNotice">
          {message}
        </div>
      )}

      {loading&&(
        <div className="glassCard legalLoading">
          Loading legal research…
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
                    ? 'EDIT LEGAL OPINION'
                    : 'NEW LEGAL OPINION'}
                </span>

                <h3>
                  {editingId
                    ? 'Update research opinion'
                    : 'Prepare research opinion'}
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
                Opinion title
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
                Risk rating
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

              <label className="wide">
                Question presented
                <textarea
                  rows={3}
                  value={
                    draft.question_presented
                  }
                  onChange={event=>
                    setDraft({
                      ...draft,
                      question_presented:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Background / instructions
                <textarea
                  rows={4}
                  value={draft.background}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      background:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Applicable law
                <textarea
                  rows={4}
                  value={draft.applicable_law}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      applicable_law:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Authorities
                <textarea
                  rows={4}
                  value={draft.authorities}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      authorities:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Legal analysis
                <textarea
                  rows={8}
                  value={draft.analysis}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      analysis:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Conclusion
                <textarea
                  rows={4}
                  value={draft.conclusion}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      conclusion:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="wide">
                Recommendation
                <textarea
                  rows={4}
                  value={draft.recommendation}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      recommendation:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="legalPrivilegeToggle wide">
                <input
                  type="checkbox"
                  checked={draft.privileged}
                  onChange={event=>
                    setDraft({
                      ...draft,
                      privileged:
                        event.target.checked,
                    })
                  }
                />

                <span>
                  <strong>
                    Privileged legal advice
                  </strong>
                  <small>
                    Restrict this opinion to
                    Legal and Administration.
                  </small>
                </span>
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
                  placeholder="Search questions, law or authorities"
                  value={search}
                  onChange={event=>
                    setSearch(
                      event.target.value
                    )
                  }
                />
              </label>

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
                value={privilegeFilter}
                onChange={event=>
                  setPrivilegeFilter(
                    event.target.value
                  )
                }
              >
                <option value="all">
                  All access levels
                </option>
                <option value="privileged">
                  Privileged
                </option>
                <option value="internal">
                  Non-privileged
                </option>
              </select>
            </div>

            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Opinion</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Access</th>
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
                        {label(item.status)}
                      </td>

                      <td>
                        {label(
                          item.risk_rating
                        )}
                      </td>

                      <td>
                        {item.privileged
                          ? 'Privileged'
                          : 'Internal'}
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
                      <td colSpan={5}>
                        No legal opinions match
                        these filters.
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
                {selected.privileged
                  ? 'PRIVILEGED LEGAL ADVICE'
                  : 'INTERNAL LEGAL RESEARCH'}
              </span>

              <h2>{selected.title}</h2>

              <p>
                {label(selected.status)}
                {' · '}
                {label(
                  selected.risk_rating
                )} risk
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

          <div className="lawReportBody">
            {[
              [
                'Question Presented',
                selected.question_presented,
              ],
              [
                'Background / Instructions',
                selected.background,
              ],
              [
                'Applicable Law',
                selected.applicable_law,
              ],
              [
                'Authorities',
                selected.authorities,
              ],
              [
                'Legal Analysis',
                selected.analysis,
              ],
              [
                'Conclusion',
                selected.conclusion,
              ],
              [
                'Recommendation',
                selected.recommendation,
              ],
            ].map(([title,value])=>(
              <section
                className="lawReportSection"
                key={title}
              >
                <h4>{title}</h4>
                <p>
                  {value ||
                    'Not recorded.'}
                </p>
              </section>
            ))}
          </div>

          {selected.privileged&&(
            <div className="legalPrivilegeNotice">
              <LockKeyhole size={18}/>
              <div>
                <strong>
                  Privileged legal material
                </strong>
                <span>
                  Restricted to authorised
                  Legal and Administration users.
                </span>
              </div>
            </div>
          )}
        </article>
      )}
    </div>
  )
}
