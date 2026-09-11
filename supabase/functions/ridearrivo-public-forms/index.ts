import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const launchSlug =
  "ridearrivo-launch-2026"

const interestTypes =
  new Set([
    "investment",
    "partnership",
    "information",
    "meeting",
  ])

const interestStatuses =
  new Set([
    "new",
    "contacted",
    "qualified",
    "closed",
  ])

const publicOrigins =
  new Set([
    "https://forms.ridearrivo.com",
    "https://feat-room7-external-events.ra-workspace.pages.dev",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ])

const staffOrigins =
  new Set([
    "https://intranet.ridearrivo.com",
    "https://feat-room7-external-events.ra-workspace.pages.dev",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ])

function text(
  value: unknown,
  max: number,
) {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .trim()
    .slice(0, max)
}

function email(
  value: unknown,
) {
  const candidate =
    text(value, 320)
      .toLowerCase()

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      candidate,
    )
  ) {
    return ""
  }

  return candidate
}

function corsOrigin(
  req: Request,
) {
  const origin =
    req.headers.get("origin") || ""

  if (
    publicOrigins.has(origin) ||
    staffOrigins.has(origin)
  ) {
    return origin
  }

  return ""
}

function json(
  req: Request,
  status: number,
  body: unknown,
) {
  const origin =
    corsOrigin(req)

  const headers =
    new Headers({
      "Content-Type":
        "application/json",
      "Cache-Control":
        "no-store",
      "Vary":
        "Origin",
    })

  if (origin) {
    headers.set(
      "Access-Control-Allow-Origin",
      origin,
    )
  }

  return new Response(
    JSON.stringify(body),
    {
      status,
      headers,
    },
  )
}

function adminClient() {
  const url =
    Deno.env.get("SUPABASE_URL") || ""

  const key =
    Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    ) || ""

  if (!url || !key) {
    throw new Error(
      "Server configuration is incomplete.",
    )
  }

  return createClient(
    url,
    key,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )
}

async function requireStaff(
  req: Request,
  admin: ReturnType<
    typeof adminClient
  >,
) {
  const authorization =
    req.headers.get("authorization") || ""

  const token =
    authorization
      .replace(/^Bearer\s+/i, "")
      .trim()

  if (!token) {
    throw new Response(
      JSON.stringify({
        error:
          "RideArrivo staff authentication is required.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  const {
    data: authData,
    error: authError,
  } =
    await admin.auth.getUser(token)

  if (
    authError ||
    !authData.user
  ) {
    throw new Response(
      JSON.stringify({
        error:
          "Your RideArrivo session is invalid or expired.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  const {
    data: profile,
    error: profileError,
  } =
    await admin
      .from("employee_profiles")
      .select("id,role,active")
      .eq(
        "id",
        authData.user.id,
      )
      .eq(
        "active",
        true,
      )
      .maybeSingle()

  if (
    profileError ||
    !profile
  ) {
    throw new Response(
      JSON.stringify({
        error:
          "Active RideArrivo employee access is required.",
      }),
      {
        status: 403,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  const role =
    text(profile.role, 40)
      .toLowerCase()

  if (
    ![
      "support",
      "manager",
      "admin",
    ].includes(role)
  ) {
    throw new Response(
      JSON.stringify({
        error:
          "Investor enquiry access is restricted to Support, Manager and Administrator accounts.",
      }),
      {
        status: 403,
        headers: {
          "Content-Type":
            "application/json",
        },
      },
    )
  }

  return {
    id: profile.id as string,
    role,
  }
}

serve(async req => {
  if (
    req.method === "OPTIONS"
  ) {
    const origin =
      corsOrigin(req)

    return new Response(
      null,
      {
        status: origin
          ? 204
          : 403,
        headers: origin
          ? {
              "Access-Control-Allow-Origin":
                origin,
              "Access-Control-Allow-Headers":
                "authorization, apikey, content-type",
              "Access-Control-Allow-Methods":
                "POST, OPTIONS",
              "Access-Control-Max-Age":
                "86400",
              "Vary":
                "Origin",
            }
          : undefined,
      },
    )
  }

  if (
    req.method !== "POST"
  ) {
    return json(
      req,
      405,
      {
        error:
          "Method not allowed.",
      },
    )
  }

  try {
    const body =
      await req.json()
        .catch(() => ({}))

    const action =
      text(
        body?.action,
        80,
      )

    const admin =
      adminClient()

    if (
      action ===
      "submit_investor_interest"
    ) {
      const origin =
        req.headers.get(
          "origin",
        ) || ""

      if (
        !publicOrigins.has(
          origin,
        )
      ) {
        return json(
          req,
          403,
          {
            error:
              "This form is not available from this origin.",
          },
        )
      }

      // Quietly absorb automated
      // honeypot submissions.
      if (
        text(
          body?.website,
          200,
        )
      ) {
        return json(
          req,
          201,
          {
            received: true,
          },
        )
      }

      const displayName =
        text(
          body?.display_name,
          180,
        )

      const emailAddress =
        email(
          body?.email,
        )

      if (
        !displayName ||
        !emailAddress
      ) {
        return json(
          req,
          400,
          {
            error:
              "Your name and a valid email address are required.",
          },
        )
      }

      if (
        body?.contact_consent !==
        true
      ) {
        return json(
          req,
          400,
          {
            error:
              "Contact consent is required before submitting your enquiry.",
          },
        )
      }

      const interestType =
        text(
          body?.interest_type,
          40,
        ).toLowerCase()

      if (
        !interestTypes.has(
          interestType,
        )
      ) {
        return json(
          req,
          400,
          {
            error:
              "Select a valid area of interest.",
          },
        )
      }

      const company =
        text(
          body?.company,
          180,
        )

      const phone =
        text(
          body?.phone,
          40,
        )

      const investmentRange =
        text(
          body?.investment_range,
          120,
        )

      const message =
        text(
          body?.message,
          2000,
        )

      const {
        data: external,
        error: externalError,
      } =
        await admin
          .from(
            "room7_external_rooms",
          )
          .select(
            "room_id,slug,public_enabled",
          )
          .eq(
            "slug",
            launchSlug,
          )
          .eq(
            "public_enabled",
            true,
          )
          .maybeSingle()

      if (
        externalError ||
        !external
      ) {
        return json(
          req,
          503,
          {
            error:
              "RideArrivo investor enquiries are temporarily unavailable.",
          },
        )
      }

      const {
        data: content,
        error: contentError,
      } =
        await admin
          .from(
            "room7_event_content",
          )
          .select(
            "investor_interest_enabled",
          )
          .eq(
            "room_id",
            external.room_id,
          )
          .maybeSingle()

      if (contentError) {
        throw contentError
      }

      if (
        content &&
        content
          .investor_interest_enabled ===
          false
      ) {
        return json(
          req,
          403,
          {
            error:
              "Investor and stakeholder follow-up is not available right now.",
          },
        )
      }

      const {
        data: existing,
        error: existingError,
      } =
        await admin
          .from(
            "room7_investor_interest",
          )
          .select(
            "id,status,last_submitted_at",
          )
          .eq(
            "room_id",
            external.room_id,
          )
          .eq(
            "email",
            emailAddress,
          )
          .maybeSingle()

      if (existingError) {
        throw existingError
      }

      const now =
        new Date()

      if (
        existing
          ?.last_submitted_at &&
        now.getTime() -
          new Date(
            existing
              .last_submitted_at,
          ).getTime() <
          60_000
      ) {
        return json(
          req,
          429,
          {
            error:
              "Please wait a moment before submitting another enquiry.",
          },
        )
      }

      if (existing) {
        const nextStatus =
          existing.status ===
          "closed"
            ? "new"
            : existing.status

        const {
          error: updateError,
        } =
          await admin
            .from(
              "room7_investor_interest",
            )
            .update({
              display_name:
                displayName,
              company:
                company ||
                null,
              phone:
                phone ||
                null,
              interest_type:
                interestType,
              investment_range:
                investmentRange ||
                null,
              message:
                message ||
                null,
              contact_consent:
                true,
              consent_version:
                "forms-investor-contact-v1",
              consent_at:
                now.toISOString(),
              last_submitted_at:
                now.toISOString(),
              status:
                nextStatus,
            })
            .eq(
              "id",
              existing.id,
            )
            .eq(
              "room_id",
              external.room_id,
            )

        if (updateError) {
          throw updateError
        }
      } else {
        const {
          error: insertError,
        } =
          await admin
            .from(
              "room7_investor_interest",
            )
            .insert({
              room_id:
                external.room_id,
              invitation_id:
                null,
              guest_id:
                null,
              display_name:
                displayName,
              email:
                emailAddress,
              company:
                company ||
                null,
              phone:
                phone ||
                null,
              interest_type:
                interestType,
              investment_range:
                investmentRange ||
                null,
              message:
                message ||
                null,
              contact_consent:
                true,
              consent_version:
                "forms-investor-contact-v1",
              consent_at:
                now.toISOString(),
              last_submitted_at:
                now.toISOString(),
              status:
                "new",
            })

        if (insertError) {
          throw insertError
        }
      }

      return json(
        req,
        201,
        {
          received: true,
          message:
            "Your RideArrivo enquiry has been received.",
        },
      )
    }

    if (
      action ===
      "staff_list_investor_interest"
    ) {
      await requireStaff(
        req,
        admin,
      )

      const {
        data,
        error,
      } =
        await admin
          .from(
            "room7_investor_interest",
          )
          .select(
            "id,room_id,display_name,email,company,phone,interest_type,investment_range,message,contact_consent,consent_at,status,internal_notes,assigned_to,submitted_at,last_submitted_at,updated_at",
          )
          .order(
            "last_submitted_at",
            {
              ascending:
                false,
            },
          )
          .limit(200)

      if (error) {
        throw error
      }

      return json(
        req,
        200,
        {
          records:
            data || [],
        },
      )
    }

    if (
      action ===
      "staff_update_investor_interest"
    ) {
      const staff =
        await requireStaff(
          req,
          admin,
        )

      const id =
        text(
          body?.id,
          80,
        )

      const status =
        text(
          body?.status,
          40,
        ).toLowerCase()

      const internalNotes =
        text(
          body?.internal_notes,
          5000,
        )

      if (!id) {
        return json(
          req,
          400,
          {
            error:
              "Investor enquiry ID is required.",
          },
        )
      }

      if (
        !interestStatuses.has(
          status,
        )
      ) {
        return json(
          req,
          400,
          {
            error:
              "Select a valid follow-up status.",
          },
        )
      }

      const {
        data,
        error,
      } =
        await admin
          .from(
            "room7_investor_interest",
          )
          .update({
            status,
            internal_notes:
              internalNotes ||
              null,
            assigned_to:
              staff.id,
          })
          .eq(
            "id",
            id,
          )
          .select(
            "id,status,internal_notes,assigned_to,updated_at",
          )
          .single()

      if (error) {
        throw error
      }

      return json(
        req,
        200,
        {
          record:
            data,
        },
      )
    }

    return json(
      req,
      400,
      {
        error:
          "Unsupported RideArrivo Forms action.",
      },
    )
  } catch (cause) {
    if (
      cause instanceof Response
    ) {
      const body =
        await cause.text()

      return json(
        req,
        cause.status,
        JSON.parse(body),
      )
    }

    console.error(
      "RideArrivo Forms error",
      cause,
    )

    return json(
      req,
      500,
      {
        error:
          "Unable to process this RideArrivo request.",
      },
    )
  }
})
