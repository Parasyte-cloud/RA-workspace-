import type { FormEvent } from 'react'

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Landmark,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import '../marketing-wallet.css'

type Wallet = {
  id:string
  wallet_code:string
  name:string
  currency:string
  status:string
  created_at:string
}

type Authorization = {
  authority:'operator'|'final_approver'
  active:boolean
}

type Vendor = {
  id:string
  wallet_id:string
  legal_name:string
  display_name:string|null
  bank_name:string|null
  account_name:string|null
  account_last4:string|null
  verification_status:
    | 'pending'
    | 'verified'
    | 'suspended'
    | 'rejected'
}

type FundingRequest = {
  id:string
  wallet_id:string
  amount:number|string
  purpose:string
  status:string
  finance_note:string|null
  executive_note:string|null
  created_at:string
  updated_at:string
}

type PaymentRequest = {
  id:string
  wallet_id:string
  vendor_id:string
  amount:number|string
  narration:string
  status:string
  executive_note:string|null
  created_at:string
  updated_at:string
}

type LedgerEntry = {
  id:string
  wallet_id:string
  entry_type:
    | 'funding_credit'
    | 'vendor_reservation'
    | 'vendor_settlement'
    | 'reservation_release'
    | 'reversal'
  available_delta:number|string
  reserved_delta:number|string
  description:string
  created_at:string
}

function numeric(
  value:number|string|null|undefined
){
  const parsed=Number(value || 0)

  return Number.isFinite(parsed)
    ? parsed
    : 0
}

function money(
  value:number|string|null|undefined
){
  return new Intl.NumberFormat(
    'en-NG',
    {
      style:'currency',
      currency:'NGN',
      maximumFractionDigits:2
    }
  ).format(
    numeric(value)
  )
}

function dateTime(value:string){
  const parsed=new Date(value)

  if(Number.isNaN(parsed.getTime())){
    return value
  }

  return new Intl.DateTimeFormat(
    'en-NG',
    {
      dateStyle:'medium',
      timeStyle:'short'
    }
  ).format(parsed)
}

function statusLabel(status:string){
  return status
    .replace(/_/g,' ')
    .replace(
      /\b\w/g,
      (character:string)=>character.toUpperCase()
    )
}

function statusClass(status:string){
  if(
    [
      'funded',
      'settled',
      'succeeded'
    ].includes(status)
  ){
    return 'success'
  }

  if(
    [
      'rejected',
      'failed',
      'cancelled'
    ].includes(status)
  ){
    return 'danger'
  }

  if(
    [
      'finance_review',
      'executive_approval',
      'approved_for_funding',
      'approved_for_transfer',
      'funding_in_progress',
      'transfer_in_progress',
      'submitted'
    ].includes(status)
  ){
    return 'pending'
  }

  return 'neutral'
}

export default function MarketingWalletPanel(){

  const [wallet,setWallet]=
    useState<Wallet|null>(null)

  const [authorizations,setAuthorizations]=
    useState<Authorization[]>([])

  const [vendors,setVendors]=
    useState<Vendor[]>([])

  const [fundingRequests,setFundingRequests]=
    useState<FundingRequest[]>([])

  const [paymentRequests,setPaymentRequests]=
    useState<PaymentRequest[]>([])

  const [ledger,setLedger]=
    useState<LedgerEntry[]>([])

  const [loading,setLoading]=
    useState(true)

  const [submittingFunding,setSubmittingFunding]=
    useState(false)

  const [submittingPayment,setSubmittingPayment]=
    useState(false)

  const [notice,setNotice]=
    useState('')

  const [error,setError]=
    useState('')

  const [fundingAmount,setFundingAmount]=
    useState('')

  const [fundingPurpose,setFundingPurpose]=
    useState('')

  const [paymentAmount,setPaymentAmount]=
    useState('')

  const [paymentNarration,setPaymentNarration]=
    useState('')

  const [paymentVendorId,setPaymentVendorId]=
    useState('')

  const canOperate=
    authorizations.some(
      authorization=>
        authorization.active &&
        authorization.authority==='operator'
    )

  const canReadFinancials=
    authorizations.some(
      authorization=>
        authorization.active &&
        (
          authorization.authority==='operator'
          || authorization.authority==='final_approver'
        )
    )

  const verifiedVendors=
    useMemo(
      ()=>vendors.filter(
        vendor=>
          vendor.verification_status==='verified'
      ),
      [vendors]
    )

  const balances=
    useMemo(
      ()=>{
        const available=
          ledger.reduce(
            (total,entry)=>
              total+
              numeric(entry.available_delta),
            0
          )

        const reserved=
          ledger.reduce(
            (total,entry)=>
              total+
              numeric(entry.reserved_delta),
            0
          )

        const totalFunded=
          ledger
            .filter(
              entry=>
                entry.entry_type==='funding_credit'
            )
            .reduce(
              (total,entry)=>
                total+
                Math.max(
                  numeric(
                    entry.available_delta
                  ),
                  0
                ),
              0
            )

        return {
          available,
          reserved,
          totalFunded
        }
      },
      [ledger]
    )

  const pendingFunding=
    useMemo(
      ()=>fundingRequests
        .filter(
          request=>
            ![
              'funded',
              'rejected',
              'cancelled',
              'failed'
            ].includes(request.status)
        )
        .reduce(
          (total,request)=>
            total+numeric(request.amount),
          0
        ),
      [fundingRequests]
    )

  const pendingPayments=
    useMemo(
      ()=>paymentRequests
        .filter(
          request=>
            ![
              'settled',
              'rejected',
              'cancelled',
              'failed'
            ].includes(request.status)
        )
        .reduce(
          (total,request)=>
            total+numeric(request.amount),
          0
        ),
      [paymentRequests]
    )

  const vendorById=
    useMemo(
      ()=>new Map(
        vendors.map(
          vendor=>[
            vendor.id,
            vendor
          ]
        )
      ),
      [vendors]
    )

  const loadWallet=
    useCallback(
      async()=>{
        const client=supabase

        if(!client){
          setError(
            'Supabase is not configured.'
          )
          setLoading(false)
          return
        }

        setLoading(true)
        setError('')

        try{

          const {
            data:walletRows,
            error:walletError
          }=
            await client
              .from('marketing_wallets')
              .select(
                'id,wallet_code,name,currency,status,created_at'
              )
              .eq(
                'department',
                'marketing'
              )
              .eq(
                'status',
                'active'
              )
              .order(
                'created_at',
                {
                  ascending:true
                }
              )
              .limit(1)

          if(walletError){
            throw walletError
          }

          const activeWallet=
            (walletRows?.[0] || null) as Wallet|null

          setWallet(activeWallet)

          if(!activeWallet){
            setAuthorizations([])
            setVendors([])
            setFundingRequests([])
            setPaymentRequests([])
            setLedger([])
            return
          }

          const [
            authorizationResult,
            fundingResult,
            paymentResult
          ]=
            await Promise.all([
              client
                .from(
                  'marketing_wallet_authorizations'
                )
                .select(
                  'authority,active'
                )
                .eq(
                  'wallet_id',
                  activeWallet.id
                )
                .eq(
                  'active',
                  true
                ),

              client
                .from(
                  'marketing_wallet_funding_requests'
                )
                .select(
                  'id,wallet_id,amount,purpose,status,finance_note,executive_note,created_at,updated_at'
                )
                .eq(
                  'wallet_id',
                  activeWallet.id
                )
                .order(
                  'created_at',
                  {
                    ascending:false
                  }
                )
                .limit(30),

              client
                .from(
                  'marketing_wallet_payment_requests'
                )
                .select(
                  'id,wallet_id,vendor_id,amount,narration,status,executive_note,created_at,updated_at'
                )
                .eq(
                  'wallet_id',
                  activeWallet.id
                )
                .order(
                  'created_at',
                  {
                    ascending:false
                  }
                )
                .limit(30)
            ])

          if(authorizationResult.error){
            throw authorizationResult.error
          }

          if(fundingResult.error){
            throw fundingResult.error
          }

          if(paymentResult.error){
            throw paymentResult.error
          }

          const authRows=
            (
              authorizationResult.data || []
            ) as Authorization[]

          setAuthorizations(authRows)

          setFundingRequests(
            (fundingResult.data || []) as FundingRequest[]
          )

          setPaymentRequests(
            (paymentResult.data || []) as PaymentRequest[]
          )

          const hasFinancialAuthority=
            authRows.some(
              authorization=>
                authorization.active &&
                (
                  authorization.authority===
                    'operator'
                  || authorization.authority===
                    'final_approver'
                )
            )

          if(!hasFinancialAuthority){
            setVendors([])
            setLedger([])
            return
          }

          const [
            vendorResult,
            ledgerResult
          ]=
            await Promise.all([
              client
                .from(
                  'marketing_wallet_vendors'
                )
                .select(
                  'id,wallet_id,legal_name,display_name,bank_name,account_name,account_last4,verification_status'
                )
                .eq(
                  'wallet_id',
                  activeWallet.id
                )
                .order(
                  'legal_name',
                  {
                    ascending:true
                  }
                ),

              client
                .from(
                  'marketing_wallet_ledger'
                )
                .select(
                  'id,wallet_id,entry_type,available_delta,reserved_delta,description,created_at'
                )
                .eq(
                  'wallet_id',
                  activeWallet.id
                )
                .order(
                  'created_at',
                  {
                    ascending:false
                  }
                )
                .limit(100)
            ])

          if(vendorResult.error){
            throw vendorResult.error
          }

          if(ledgerResult.error){
            throw ledgerResult.error
          }

          setVendors(
            (vendorResult.data || []) as Vendor[]
          )

          setLedger(
            (ledgerResult.data || []) as LedgerEntry[]
          )

        }catch(caught){

          console.error(
            'Marketing wallet load failed:',
            caught
          )

          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load Marketing Wallet.'
          )

        }finally{
          setLoading(false)
        }
      },
      []
    )

  useEffect(
    ()=>{
      void loadWallet()
    },
    [loadWallet]
  )

  const submitFunding=
    async(
      event:
        FormEvent<HTMLFormElement>
    )=>{
      event.preventDefault()

      const client=supabase

      if(
        !client
        || !wallet
        || !canOperate
        || submittingFunding
      ){
        return
      }

      const amount=
        Number(fundingAmount)

      const purpose=
        fundingPurpose.trim()

      if(
        !Number.isFinite(amount)
        || amount<=0
      ){
        setError(
          'Funding amount must be greater than zero.'
        )
        return
      }

      if(!purpose){
        setError(
          'Funding purpose is required.'
        )
        return
      }

      setSubmittingFunding(true)
      setError('')
      setNotice('')

      try{

        const {
          error:rpcError
        }=
          await client.rpc(
            'marketing_wallet_submit_funding_request',
            {
              p_wallet_id:
                wallet.id,
              p_amount:
                amount,
              p_purpose:
                purpose,
              p_idempotency_key:
                crypto.randomUUID(),
              p_budget_id:
                null,
              p_campaign_id:
                null
            }
          )

        if(rpcError){
          throw rpcError
        }

        setFundingAmount('')
        setFundingPurpose('')

        setNotice(
          'Funding request submitted for Finance review.'
        )

        await loadWallet()

      }catch(caught){

        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to submit funding request.'
        )

      }finally{
        setSubmittingFunding(false)
      }
    }

  const submitPayment=
    async(
      event:
        FormEvent<HTMLFormElement>
    )=>{
      event.preventDefault()

      const client=supabase

      if(
        !client
        || !wallet
        || !canOperate
        || submittingPayment
      ){
        return
      }

      const amount=
        Number(paymentAmount)

      const narration=
        paymentNarration.trim()

      const vendor=
        verifiedVendors.find(
          candidate=>
            candidate.id===paymentVendorId
        )

      if(!vendor){
        setError(
          'Choose a verified Marketing Wallet vendor.'
        )
        return
      }

      if(
        !Number.isFinite(amount)
        || amount<=0
      ){
        setError(
          'Payment amount must be greater than zero.'
        )
        return
      }

      if(!narration){
        setError(
          'Payment narration is required.'
        )
        return
      }

      setSubmittingPayment(true)
      setError('')
      setNotice('')

      try{

        const {
          error:rpcError
        }=
          await client.rpc(
            'marketing_wallet_submit_payment_request',
            {
              p_wallet_id:
                wallet.id,
              p_vendor_id:
                vendor.id,
              p_amount:
                amount,
              p_narration:
                narration,
              p_idempotency_key:
                crypto.randomUUID(),
              p_budget_id:
                null,
              p_campaign_id:
                null
            }
          )

        if(rpcError){
          throw rpcError
        }

        setPaymentAmount('')
        setPaymentNarration('')
        setPaymentVendorId('')

        setNotice(
          'Payment request submitted for governed approval.'
        )

        await loadWallet()

      }catch(caught){

        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to submit payment request.'
        )

      }finally{
        setSubmittingPayment(false)
      }
    }

  if(loading){
    return (
      <section className="marketingWallet">
        <div className="marketingWalletLoading glassCard">
          <LoaderCircle
            size={22}
            className="marketingWalletSpin"
          />
          Loading Marketing Wallet...
        </div>
      </section>
    )
  }

  if(!wallet){
    return (
      <section className="marketingWallet">
        <div className="marketingWalletEmpty glassCard">
          <WalletCards size={28}/>

          <div>
            <span className="eyebrow">
              MARKETING WALLET
            </span>

            <h3>
              Wallet setup required
            </h3>

            <p>
              No active Marketing Wallet is currently
              visible to this account. The governed
              bootstrap migration must be reviewed and
              applied before the wallet can be used.
            </p>
          </div>

          <button
            type="button"
            className="glassButton"
            onClick={()=>{
              void loadWallet()
            }}
          >
            <RefreshCw size={15}/>
            Refresh
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="marketingWallet">

      <div className="marketingWalletHero glassCard">

        <div>
          <span className="eyebrow">
            MARKETING FINANCE
          </span>

          <h3>
            {wallet.name}
          </h3>

          <p>
            Governed campaign funding and vendor
            payments. Marketing requests; Finance
            reviews; authorised executives approve;
            bank execution remains controlled.
          </p>

          <div className="marketingWalletIdentity">
            <span>
              <WalletCards size={15}/>
              {wallet.wallet_code}
            </span>

            <span>
              <BadgeCheck size={15}/>
              {wallet.status}
            </span>

            <span>
              <ShieldCheck size={15}/>
              {canOperate
                ? 'Operator authorised'
                : 'Read-only'}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="glassButton"
          onClick={()=>{
            void loadWallet()
          }}
        >
          <RefreshCw size={15}/>
          Refresh
        </button>

      </div>

      {!canReadFinancials && (
        <div className="marketingWalletAuthorityNotice glassCard">
          <ShieldCheck size={20}/>

          <div>
            <strong>
              Wallet operator authority required
            </strong>

            <p>
              You can see the Marketing Wallet,
              but financial ledger details and
              request actions remain restricted
              until Administration grants explicit
              wallet operator authority.
            </p>
          </div>
        </div>
      )}

      <div className="marketingWalletMetrics">

        <article className="glassCard">
          <span>Available balance</span>
          <strong>
            {canReadFinancials
              ? money(balances.available)
              : 'Restricted'}
          </strong>
          <small>
            Settled funds available for approved use.
          </small>
        </article>

        <article className="glassCard">
          <span>Reserved</span>
          <strong>
            {canReadFinancials
              ? money(balances.reserved)
              : 'Restricted'}
          </strong>
          <small>
            Approved payments awaiting settlement.
          </small>
        </article>

        <article className="glassCard">
          <span>Total funded</span>
          <strong>
            {canReadFinancials
              ? money(balances.totalFunded)
              : 'Restricted'}
          </strong>
          <small>
            Confirmed funding credits in the ledger.
          </small>
        </article>

        <article className="glassCard">
          <span>Pending funding</span>
          <strong>
            {money(pendingFunding)}
          </strong>
          <small>
            Requests still within the approval flow.
          </small>
        </article>

        <article className="glassCard">
          <span>Pending payments</span>
          <strong>
            {money(pendingPayments)}
          </strong>
          <small>
            Requests not yet settled or closed.
          </small>
        </article>

      </div>

      {canOperate && (
        <div className="marketingWalletActions">

          <form
            className="marketingWalletForm glassCard"
            onSubmit={submitFunding}
          >
            <div className="marketingWalletFormTitle">
              <CircleDollarSign size={20}/>
              <div>
                <span className="eyebrow">
                  FUNDING
                </span>
                <h4>
                  Request funding
                </h4>
              </div>
            </div>

            <label>
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={fundingAmount}
                onChange={event=>{
                  setFundingAmount(
                    event.target.value
                  )
                }}
                placeholder="500000"
              />
            </label>

            <label>
              Business purpose
              <textarea
                required
                rows={4}
                value={fundingPurpose}
                onChange={event=>{
                  setFundingPurpose(
                    event.target.value
                  )
                }}
                placeholder="September campaign media budget..."
              />
            </label>

            <div className="marketingWalletFlow">
              <span>Marketing request</span>
              <span>Finance review</span>
              <span>Executive approval</span>
              <span>Funding confirmation</span>
            </div>

            <button
              type="submit"
              className="primaryButton"
              disabled={submittingFunding}
            >
              {submittingFunding
                ? (
                  <>
                    <LoaderCircle
                      size={15}
                      className="marketingWalletSpin"
                    />
                    Submitting...
                  </>
                )
                : (
                  <>
                    <Send size={15}/>
                    Request Funding
                  </>
                )
              }
            </button>
          </form>

          <form
            className="marketingWalletForm glassCard"
            onSubmit={submitPayment}
          >
            <div className="marketingWalletFormTitle">
              <CreditCard size={20}/>
              <div>
                <span className="eyebrow">
                  SPEND
                </span>
                <h4>
                  Request payment
                </h4>
              </div>
            </div>

            <label>
              Verified vendor
              <select
                required
                value={paymentVendorId}
                onChange={event=>{
                  setPaymentVendorId(
                    event.target.value
                  )
                }}
                disabled={
                  verifiedVendors.length===0
                }
              >
                <option value="">
                  {verifiedVendors.length
                    ? 'Choose vendor'
                    : 'No verified vendors available'}
                </option>

                {verifiedVendors.map(
                  vendor=>(
                    <option
                      key={vendor.id}
                      value={vendor.id}
                    >
                      {vendor.display_name ||
                        vendor.legal_name}
                      {vendor.bank_name
                        ? ` · ${vendor.bank_name}`
                        : ''}
                      {vendor.account_last4
                        ? ` · ••••${vendor.account_last4}`
                        : ''}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={paymentAmount}
                onChange={event=>{
                  setPaymentAmount(
                    event.target.value
                  )
                }}
                placeholder="120000"
              />
            </label>

            <label>
              Narration
              <textarea
                required
                rows={3}
                value={paymentNarration}
                onChange={event=>{
                  setPaymentNarration(
                    event.target.value
                  )
                }}
                placeholder="Meta Ads campaign payment..."
              />
            </label>

            {verifiedVendors.length===0 && (
              <p className="marketingWalletVendorNotice">
                Finance must create and verify a vendor
                before Marketing can submit a payment
                request. Bank account details are not
                entered here by Marketing.
              </p>
            )}

            <button
              type="submit"
              className="primaryButton"
              disabled={
                submittingPayment ||
                verifiedVendors.length===0
              }
            >
              {submittingPayment
                ? (
                  <>
                    <LoaderCircle
                      size={15}
                      className="marketingWalletSpin"
                    />
                    Submitting...
                  </>
                )
                : (
                  <>
                    <CreditCard size={15}/>
                    Request Payment
                  </>
                )
              }
            </button>
          </form>

        </div>
      )}

      {notice && (
        <div
          className="marketingWalletNotice success glassCard"
          role="status"
        >
          <BadgeCheck size={18}/>
          {notice}
        </div>
      )}

      {error && (
        <div
          className="marketingWalletNotice danger glassCard"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="marketingWalletLists">

        <section className="glassCard marketingWalletList">
          <div className="marketingWalletListHeader">
            <div>
              <span className="eyebrow">
                FUNDING REQUESTS
              </span>
              <h4>
                Funding pipeline
              </h4>
            </div>
            <Landmark size={20}/>
          </div>

          {fundingRequests.length===0
            ? (
              <p className="marketingWalletEmptyText">
                No funding requests yet.
              </p>
            )
            : fundingRequests.map(
                request=>(
                  <article
                    key={request.id}
                    className="marketingWalletRow"
                  >
                    <div>
                      <strong>
                        {money(request.amount)}
                      </strong>
                      <span>
                        {request.purpose}
                      </span>
                      <small>
                        {dateTime(request.created_at)}
                      </small>
                    </div>

                    <span
                      className={
                        `marketingWalletStatus ${statusClass(request.status)}`
                      }
                    >
                      {statusLabel(request.status)}
                    </span>
                  </article>
                )
              )
          }
        </section>

        <section className="glassCard marketingWalletList">
          <div className="marketingWalletListHeader">
            <div>
              <span className="eyebrow">
                PAYMENT REQUESTS
              </span>
              <h4>
                Payment pipeline
              </h4>
            </div>
            <CreditCard size={20}/>
          </div>

          {paymentRequests.length===0
            ? (
              <p className="marketingWalletEmptyText">
                No payment requests yet.
              </p>
            )
            : paymentRequests.map(
                request=>{
                  const vendor=
                    vendorById.get(
                      request.vendor_id
                    )

                  return (
                    <article
                      key={request.id}
                      className="marketingWalletRow"
                    >
                      <div>
                        <strong>
                          {money(request.amount)}
                        </strong>

                        <span>
                          {request.narration}
                        </span>

                        <small>
                          {vendor
                            ? (
                              vendor.display_name ||
                              vendor.legal_name
                            )
                            : 'Vendor'}
                          {' · '}
                          {dateTime(
                            request.created_at
                          )}
                        </small>
                      </div>

                      <span
                        className={
                          `marketingWalletStatus ${statusClass(request.status)}`
                        }
                      >
                        {statusLabel(request.status)}
                      </span>
                    </article>
                  )
                }
              )
          }
        </section>

      </div>

      {canReadFinancials && (
        <section className="glassCard marketingWalletLedger">

          <div className="marketingWalletListHeader">
            <div>
              <span className="eyebrow">
                WALLET ACTIVITY
              </span>
              <h4>
                Financial ledger
              </h4>
            </div>

            <Clock3 size={20}/>
          </div>

          {ledger.length===0
            ? (
              <p className="marketingWalletEmptyText">
                No settled wallet activity yet.
              </p>
            )
            : ledger.slice(0,20).map(
                entry=>(
                  <article
                    key={entry.id}
                    className="marketingWalletLedgerRow"
                  >
                    <div>
                      <strong>
                        {statusLabel(
                          entry.entry_type
                        )}
                      </strong>

                      <span>
                        {entry.description}
                      </span>
                    </div>

                    <div>
                      <strong>
                        {numeric(
                          entry.available_delta
                        )!==0
                          ? money(
                              entry.available_delta
                            )
                          : money(
                              entry.reserved_delta
                            )
                        }
                      </strong>

                      <small>
                        {dateTime(entry.created_at)}
                      </small>
                    </div>
                  </article>
                )
              )
          }

        </section>
      )}

      <div className="marketingWalletBoundary glassCard">
        <Landmark size={20}/>

        <div>
          <strong>
            Governed wallet, not a direct bank console
          </strong>

          <p>
            Marketing cannot approve its own funding,
            manufacture a balance, enter arbitrary bank
            beneficiaries, mark transfers as settled or
            call Providus directly from this workstation.
          </p>
        </div>
      </div>

    </section>
  )
}
