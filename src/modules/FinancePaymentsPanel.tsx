import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleDollarSign, Landmark, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../payments-dashboard.css'

type PaymentRow={
  id:string
  reference:string
  amount:number
  currency:string
  status:string
  channel?:string
  customer?:string
  occurred_at?:string|null
}

type ProviderData={
  configured:boolean
  transactions:PaymentRow[]
  settlements:PaymentRow[]
  totals?:unknown
  error?:string
}

type Payload={
  range:{days:number;from:string;to:string}
  paystack:ProviderData
  flutterwave:ProviderData
  generated_at:string
}

function money(amount:number,currency='NGN'){
  try{
    return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:2}).format(amount)
  }catch{
    return `${currency} ${Number(amount || 0).toLocaleString()}`
  }
}

function date(value?:string|null){
  if(!value) return '—'
  const parsed=new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function volume(rows:PaymentRow[]){
  return rows
    .filter(row=>['success','successful'].includes(String(row.status).toLowerCase()))
    .reduce((sum,row)=>sum+Number(row.amount || 0),0)
}

function ProviderBlock({name,data}:{name:string;data:ProviderData}){
  const transactionVolume=useMemo(()=>volume(data.transactions),[data.transactions])
  const settlementVolume=useMemo(()=>data.settlements.reduce((sum,row)=>sum+Number(row.amount || 0),0),[data.settlements])
  const currency=data.transactions[0]?.currency || data.settlements[0]?.currency || 'NGN'

  return (
    <article className="glassCard paymentProviderCard">
      <div className="paymentProviderHead">
        <div>
          <span className="eyebrow">{name.toUpperCase()}</span>
          <h3>{name} live finance feed</h3>
        </div>
        <span className={`paymentProviderStatus ${data.configured?'ready':'pending'}`}>
          {data.configured?'Connected':'Awaiting secret'}
        </span>
      </div>

      {!data.configured&&(
        <div className="paymentProviderNotice">
          Add the {name} secret to Supabase Edge Function secrets to activate this read-only feed.
        </div>
      )}

      {data.error&&<div className="moduleNotice">{data.error}</div>}

      <div className="paymentMiniStats">
        <div><span>Recent successful volume</span><strong>{money(transactionVolume,currency)}</strong><small>From the records returned for this dashboard window.</small></div>
        <div><span>Recent settlements</span><strong>{money(settlementVolume,currency)}</strong><small>{data.settlements.length} settlement records loaded.</small></div>
      </div>

      <div className="paymentTables">
        <div>
          <h4>Recent transactions</h4>
          {data.transactions.length===0 ? <p className="paymentEmpty">No transactions returned.</p> : (
            <div className="paymentList">
              {data.transactions.slice(0,8).map(row=>(
                <div key={`${name}-tx-${row.id}`}>
                  <span><strong>{row.reference || row.id}</strong><small>{row.customer || row.channel || 'Payment'} · {date(row.occurred_at)}</small></span>
                  <span><strong>{money(row.amount,row.currency)}</strong><small>{row.status}</small></span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4>Recent settlements</h4>
          {data.settlements.length===0 ? <p className="paymentEmpty">No settlements returned.</p> : (
            <div className="paymentList">
              {data.settlements.slice(0,8).map(row=>(
                <div key={`${name}-settlement-${row.id}`}>
                  <span><strong>{row.reference || row.id}</strong><small>{date(row.occurred_at)}</small></span>
                  <span><strong>{money(row.amount,row.currency)}</strong><small>{row.status}</small></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export default function FinancePaymentsPanel(){
  const [data,setData]=useState<Payload|null>(null)
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')
  const [days,setDays]=useState(30)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){
      setLoading(false)
      setMessage('Supabase is not configured.')
      return
    }

    setLoading(true)
    setMessage('')

    const {data,error}=await client.functions.invoke('finance-payments',{
      body:{days},
    })

    if(error){
      setData(null)
      setMessage(error.message || 'Unable to load payment providers.')
    }else{
      setData(data as Payload)
    }

    setLoading(false)
  },[days])

  useEffect(()=>{ void load() },[load])

  return (
    <section className="financePaymentsPanel">
      <div className="glassCard paymentControlHeader">
        <div>
          <span className="eyebrow">PAYMENTS CONTROL</span>
          <h3>Paystack + Flutterwave</h3>
          <p>Read-only transaction and settlement visibility inside the Finance workstation. Payment-provider secret keys stay server-side in Supabase.</p>
        </div>
        <div className="paymentControlActions">
          <select value={days} onChange={event=>setDays(Number(event.target.value))} aria-label="Payment reporting window">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="glassButton" type="button" onClick={()=>void load()} disabled={loading}>
            <RefreshCw size={15}/>{loading?'Refreshing...':'Refresh'}
          </button>
        </div>
      </div>

      <div className="paymentSecurityNote">
        <ShieldCheck size={17}/>
        <span>This release is deliberately read-only. Refunds, transfers and other money-moving actions are not exposed from the employee browser.</span>
      </div>

      {message&&<div className="moduleNotice">{message}</div>}

      {loading&&!data ? (
        <div className="glassCard paymentLoading">Loading payment providers...</div>
      ) : data ? (
        <>
          <div className="paymentSummaryGrid">
            <article className="glassCard"><CircleDollarSign/><span>Paystack records</span><strong>{data.paystack.transactions.length}</strong><small>{data.range.from} → {data.range.to}</small></article>
            <article className="glassCard"><WalletCards/><span>Flutterwave records</span><strong>{data.flutterwave.transactions.length}</strong><small>{data.range.days}-day dashboard window</small></article>
            <article className="glassCard"><Landmark/><span>Settlement feeds</span><strong>{data.paystack.settlements.length+data.flutterwave.settlements.length}</strong><small>Across connected providers</small></article>
          </div>

          <div className="paymentProviderGrid">
            <ProviderBlock name="Paystack" data={data.paystack}/>
            <ProviderBlock name="Flutterwave" data={data.flutterwave}/>
          </div>
        </>
      ) : null}
    </section>
  )
}
