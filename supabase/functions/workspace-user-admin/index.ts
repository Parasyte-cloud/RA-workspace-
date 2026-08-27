import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigin =
  "https://intranet.ridearrivo.com"

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
}

const roles = [
  "employee",
  "support",
  "engineer",
  "manager",
  "hr",
  "legal",
  "operations",
  "finance",
  "marketing",
  "partnerships",
  "admin",
]

function json(
  data: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  )
}

serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    })
  }

  try {
    const authHeader =
      req.headers.get("Authorization")

    if (!authHeader) {
      return json(
        { error: "Unauthorized" },
        401
      )
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")!

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      )!

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const token =
      authHeader.replace("Bearer ", "")

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token)

    if (
      userError ||
      !user
    ) {
      return json(
        { error: "Unauthorized" },
        401
      )
    }

    const {
      data: administrator,
      error: administratorError,
    } = await admin
      .from("employee_profiles")
      .select("id,role,active")
      .eq("id", user.id)
      .maybeSingle()

    if (
      administratorError ||
      !administrator ||
      administrator.role !== "admin" ||
      administrator.active !== true
    ) {
      return json(
        {
          error:
            "Administrator access required.",
        },
        403
      )
    }

    const body =
      req.method === "POST"
        ? await req.json().catch(() => ({}))
        : {}

    const action =
      String(body?.action || "list")

    /*
     * LIST USERS
     */
    if (action === "list") {
      const {
        data: authData,
        error: authError,
      } =
        await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        })

      if (authError) {
        throw authError
      }

      const authUsers =
        authData?.users || []

      const ids =
        authUsers.map(item => item.id)

      const {
        data: profiles,
        error: profileError,
      } = await admin
        .from("employee_profiles")
        .select(
          "id,email,full_name,role,department,job_title,active,created_at,updated_at"
        )
        .in("id", ids)

      if (profileError) {
        throw profileError
      }

      const profileMap =
        new Map(
          (profiles || []).map(
            profile => [
              profile.id,
              profile,
            ]
          )
        )

      const users =
        authUsers
          .filter(item =>
            String(
              item.email || ""
            )
              .toLowerCase()
              .endsWith(
                "@ridearrivo.com"
              )
          )
          .map(item => {
            const profile =
              profileMap.get(item.id)

            return {
              id: item.id,
              email:
                item.email || "",
              full_name:
                profile?.full_name ||
                item.user_metadata
                  ?.full_name ||
                "",
              role:
                profile?.role ||
                "employee",
              department:
                profile?.department ||
                "Unassigned",
              job_title:
                profile?.job_title ||
                "",
              active:
                profile?.active === true,
              created_at:
                item.created_at,
              last_sign_in_at:
                item.last_sign_in_at ||
                null,
              email_confirmed:
                Boolean(
                  item.email_confirmed_at
                ),
            }
          })
          .sort((a, b) => {
            if (
              a.active !== b.active
            ) {
              return a.active
                ? 1
                : -1
            }

            return (
              new Date(
                b.created_at
              ).getTime() -
              new Date(
                a.created_at
              ).getTime()
            )
          })

      return json({
        success: true,
        users,
      })
    }

    /*
     * APPROVE USER
     */
    if (action === "approve") {
      const userId =
        String(body?.userId || "")

      const role =
        String(
          body?.role || "employee"
        ).toLowerCase()

      const department =
        String(
          body?.department ||
          "Unassigned"
        ).trim()

      const jobTitle =
        String(
          body?.jobTitle || ""
        ).trim()

      const suppliedName =
        String(
          body?.fullName || ""
        ).trim()

      if (!userId) {
        return json(
          {
            error:
              "User ID is required.",
          },
          400
        )
      }

      if (!roles.includes(role)) {
        return json(
          {
            error:
              "Invalid workspace role.",
          },
          400
        )
      }

      const {
        data: targetData,
        error: targetError,
      } =
        await admin.auth.admin.getUserById(
          userId
        )

      if (
        targetError ||
        !targetData?.user
      ) {
        return json(
          {
            error:
              "Employee Auth account was not found.",
          },
          404
        )
      }

      const target =
        targetData.user

      const email =
        String(
          target.email || ""
        ).toLowerCase()

      if (
        !email.endsWith(
          "@ridearrivo.com"
        )
      ) {
        return json(
          {
            error:
              "Only RideArrivo employees can be approved.",
          },
          400
        )
      }

      const fullName =
        suppliedName ||
        String(
          target.user_metadata
            ?.full_name || ""
        ) ||
        email.split("@")[0]

      const {
        error: upsertError,
      } = await admin
        .from("employee_profiles")
        .upsert(
          {
            id: target.id,
            email,
            full_name: fullName,
            role,
            department:
              department ||
              "Unassigned",
            job_title: jobTitle,
            active: true,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "id",
          }
        )

      if (upsertError) {
        throw upsertError
      }

      return json({
        success: true,
        message:
          `${fullName} approved.`,
      })
    }

    /*
     * REVOKE USER
     */
    if (action === "revoke") {
      const userId =
        String(body?.userId || "")

      if (
        !userId ||
        userId === user.id
      ) {
        return json(
          {
            error:
              "You cannot revoke your own administrator account.",
          },
          400
        )
      }

      const {
        error,
      } = await admin
        .from("employee_profiles")
        .update({
          active: false,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", userId)

      if (error) {
        throw error
      }

      return json({
        success: true,
      })
    }

    return json(
      {
        error:
          "Unsupported action.",
      },
      400
    )
  } catch (error) {
    console.error(
      "workspace-user-admin",
      error
    )

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Administrator request failed.",
      },
      500
    )
  }
})
