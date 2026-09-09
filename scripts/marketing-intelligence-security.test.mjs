import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const path =
  'supabase/migrations/20260908102000_marketing_campaign_intelligence.sql'

const sql =
  readFileSync(path, 'utf8')

const flat =
  sql.replace(/\s+/g, ' ')

test(
  'extends the existing marketing model instead of replacing it',
  () => {
    assert.match(
      sql,
      /references public\.marketing_campaigns\(id\)/
    )

    assert.match(
      sql,
      /references public\.marketing_content/
    )

    assert.match(
      sql,
      /references public\.marketing_attribution\(id\)/
    )

    assert.doesNotMatch(
      sql,
      /drop table/i
    )

    assert.doesNotMatch(
      sql,
      /truncate/i
    )
  }
)

test(
  'creator records identify influencer source without private contact fields',
  () => {
    assert.match(
      sql,
      /create table public\.marketing_creators/
    )

    assert.match(sql, /agency_name text/)
    assert.match(sql, /sourced_via text/)
    assert.match(sql, /public_handle text/)
    assert.match(sql, /creator_code text not null unique/)

    assert.doesNotMatch(
      sql,
      /\b(email|phone|mobile|customer_name|customer_id|user_id)\s+(text|uuid)/i
    )
  }
)

test(
  'campaign creator assignments retain fee and tracking identity',
  () => {
    assert.match(
      sql,
      /create table public\.marketing_campaign_creators/
    )

    assert.match(sql, /agreed_fee numeric\(14,2\)/)
    assert.match(sql, /tracking_code text not null unique/)
    assert.match(sql, /promo_code text/)
  }
)

test(
  'creator content is constrained to its campaign assignment',
  () => {
    assert.match(
      flat,
      /foreign key \( campaign_creator_id, campaign_id \) references public\.marketing_campaign_creators/
    )

    assert.match(
      flat,
      /foreign key \( content_id, campaign_id \) references public\.marketing_content/
    )
  }
)

test(
  'tracking links are RideArrivo-only and keep UTMs separate',
  () => {
    assert.match(
      sql,
      /create table public\.marketing_tracking_links/
    )

    assert.match(sql, /utm_source text not null/)
    assert.match(sql, /utm_medium text not null/)
    assert.match(sql, /utm_campaign text not null/)
    assert.match(sql, /utm_content text/)

    assert.match(
      sql,
      /ridearrivo\\\.com/
    )

    assert.match(
      sql,
      /destination_url !~ '\[\?#\]'/
    )
  }
)

test(
  'social performance stores aggregate reach and engagement only',
  () => {
    assert.match(
      sql,
      /create table public\.marketing_performance_snapshots/
    )

    for (
      const metric of [
        'audience_followers',
        'reach',
        'impressions',
        'views',
        'engagements',
        'likes',
        'comments',
        'shares',
        'saves',
        'link_clicks'
      ]
    ) {
      assert.match(
        sql,
        new RegExp(`${metric} bigint`)
      )
    }

    assert.doesNotMatch(
      sql,
      /\bbooking_reference\s+text/i
    )
  }
)

test(
  'existing attribution remains the revenue and booking source',
  () => {
    assert.match(
      sql,
      /create table public\.marketing_attribution_links/
    )

    assert.match(
      sql,
      /attribution_id uuid not null unique/
    )

    assert.doesNotMatch(
      flat,
      /create table public\.marketing_attribution_links .* revenue numeric/
    )

    assert.doesNotMatch(
      flat,
      /create table public\.marketing_attribution_links .* bookings bigint/
    )
  }
)

test(
  'RLS preserves marketing department boundaries',
  () => {
    assert.match(
      sql,
      /array\[''marketing'',''manager'',''admin''\]/
    )

    assert.match(
      sql,
      /array\[''marketing'',''admin''\]/
    )

    assert.match(
      sql,
      /array\['marketing','manager','admin'\]/
    )

    assert.match(
      sql,
      /array\['marketing','admin'\]/
    )

    assert.match(
      flat,
      /revoke all on table public\.marketing_creators, public\.marketing_campaign_creators, public\.marketing_content_creators, public\.marketing_tracking_links, public\.marketing_performance_snapshots, public\.marketing_attribution_links from public, anon, authenticated;/
    )

    assert.doesNotMatch(
      sql,
      /grant[\s\S]{0,120}\bto anon\b/i
    )
  }
)

test(
  'performance snapshots are append-only for authenticated staff',
  () => {
    assert.match(
      sql,
      /create policy "marketing performance snapshots insert"/
    )

    assert.match(
      flat,
      /grant select, insert on table public\.marketing_performance_snapshots to authenticated/
    )

    assert.doesNotMatch(
      sql,
      /create policy "marketing performance snapshots update"/
    )

    assert.doesNotMatch(
      sql,
      /create policy "marketing performance snapshots delete"/
    )
  }
)
