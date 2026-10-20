import { supabase } from '../lib/supabase'
import { normalizeCeremonyClaim, type CeremonyClaimRow, type CeremonyPresentation } from './types'

export async function claimNextRecognitionCeremony(): Promise<CeremonyPresentation | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('claim_next_recognition_ceremony')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as CeremonyClaimRow | null
  return row?.delivery_id ? normalizeCeremonyClaim(row) : null
}

export async function markRecognitionCeremonyPresented(deliveryId: string): Promise<void> {
  if (!supabase || !deliveryId) return
  const { error } = await supabase.rpc('mark_recognition_ceremony_presented', { p_delivery_id: deliveryId })
  if (error) throw error
}

export async function dismissRecognitionCeremony(deliveryId: string): Promise<void> {
  if (!supabase || !deliveryId) return
  const { error } = await supabase.rpc('mark_recognition_ceremony_dismissed', { p_delivery_id: deliveryId })
  if (error) throw error
}
