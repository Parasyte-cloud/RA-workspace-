import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin":
    "https://intranet.ridearrivo.com",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
}

const VALID_ROLES = new Set([
  "employee",
  "support",
  "engineer",
  "cto",
  "manager",
  "hr",
  "legal",
  "operations",
  "finance",
  "marketing",
  "partnerships",
  "admin",
])

function json(
  body:unknown,
  status=200
){
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers:{
        ...corsHeaders,
        "Content-Type":"application/json",
      },
    }
  )
}

function errorMessage(error:any){
  return (
    error?.message ||
    error?.details ||
    error?.hint ||
    error?.error_description ||
    "Administrator request failed."
  )
}

serve(async(req)=>{
  if(req.method==="OPTIONS"){
    return new Response(
      "ok",
      {headers:corsHeaders}
    )
  }

  if(req.method!=="POST"){
    return json(
      {error:"Method not allowed."},
      405
    )
  }

  try{
    const authorization =
      req.headers.get("Authorization")

    if(!authorization){
      return json(
        {error:"Missing administrator session."},
        401
      )
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")

    const serviceKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      )

    if(!supabaseUrl || !serviceKey){
      console.error(
        "workspace-user-admin: missing Supabase environment"
      )

      return json(
        {
          error:
            "Administrator service is not configured.",
        },
        500
      )
    }

    const admin =
      createClient(
        supabaseUrl,
        serviceKey,
        {
          auth:{
            persistSession:false,
            autoRefreshToken:false,
          },
        }
      )

    const token =
      authorization.replace(
        /^Bearer\s+/i,
        ""
      )

    const {
      data:userData,
      error:userError,
    } =
      await admin.auth.getUser(token)

    if(
      userError ||
      !userData?.user
    ){
      console.error(
        "workspace-user-admin auth",
        userError
      )

      return json(
        {error:"Administrator session is invalid."},
        401
      )
    }

    const administratorId =
      userData.user.id

    const actorDb =
      createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY") ||
          serviceKey,
        {
          global:{
            headers:{
              Authorization:
                `Bearer ${token}`,
            },
          },
          auth:{
            persistSession:false,
            autoRefreshToken:false,
          },
        }
      )


    const {
      data:administrator,
      error:administratorError,
    } =
      await admin
        .from("employee_profiles")
        .select(
          "id,email,role,active"
        )
        .eq(
          "id",
          administratorId
        )
        .maybeSingle()

    if(administratorError){
      console.error(
        "workspace-user-admin administrator profile",
        administratorError
      )

      return json(
        {
          error:
            `Unable to verify administrator: ${errorMessage(administratorError)}`,
        },
        500
      )
    }

    if(
      !administrator ||
      administrator.active !== true ||
      String(
        administrator.role
      ).toLowerCase() !== "admin"
    ){
      return json(
        {
          error:
            "Active administrator access is required.",
        },
        403
      )
    }

    const body =
      await req.json().catch(
        ()=>({})
      )

    const action =
      String(
        body?.action || "list"
      )
        .trim()
        .toLowerCase()

    /*
     * LIST
     */
    if(action==="list"){
      const {
        data:authResult,
        error:authError,
      } =
        await admin.auth.admin.listUsers({
          page:1,
          perPage:200,
        })

      if(authError){
        console.error(
          "workspace-user-admin listUsers",
          authError
        )

        return json(
          {
            error:
              `Unable to list Auth users: ${errorMessage(authError)}`,
          },
          500
        )
      }

      const authUsers =
        authResult?.users || []

      const ids =
        authUsers.map(
          user=>user.id
        )

      let profiles:any[] = []

      if(ids.length){
        const {
          data,
          error,
        } =
          await admin
            .from("employee_profiles")
            .select(
              "id,email,full_name,role,department,job_title,manager_id,active,created_at,updated_at"
            )
            .in("id",ids)

        if(error){
          console.error(
            "workspace-user-admin profiles",
            error
          )

          return json(
            {
              error:
                `Unable to read employee profiles: ${errorMessage(error)}`,
            },
            500
          )
        }

        profiles =
          Array.isArray(data)
            ? data
            : []
      }

      const profileMap =
        new Map(
          profiles.map(
            profile=>[
              profile.id,
              profile,
            ]
          )
        )

      const users =
        authUsers
          .filter(user=>
            String(
              user.email || ""
            )
              .toLowerCase()
              .endsWith(
                "@ridearrivo.com"
              )
          )
          .map(user=>{
            const profile =
              profileMap.get(
                user.id
              )

            return {
              id:user.id,

              email:
                String(
                  user.email || ""
                ),

              full_name:
                String(
                  profile?.full_name ||
                  user.user_metadata
                    ?.full_name ||
                  ""
                ),

              department:
                String(
                  profile?.department ||
                  "Unassigned"
                ),

              role:
                String(
                  profile?.role ||
                  "employee"
                ),

              job_title:
                String(
                  profile?.job_title ||
                  ""
                ),

              manager_id:
                profile?.manager_id ||
                null,

              active:
                profile?.active === true,

              created_at:
                user.created_at,

              last_sign_in_at:
                user.last_sign_in_at ||
                null,

              email_confirmed:
                Boolean(
                  user.email_confirmed_at
                ),
            }
          })
          .sort((a,b)=>{
            if(
              a.active !== b.active
            ){
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
        success:true,
        users,
      })
    }

    /*
     * SEND PASSWORD RESET
     */
    if(action==="password-reset"){
      const userId=String(body?.userId || "").trim()
      if(!userId){
        return json({error:"Employee user ID is required."},400)
      }

      const {data:targetResult,error:targetError}=await admin.auth.admin.getUserById(userId)
      if(targetError || !targetResult?.user){
        return json({error:"Employee Auth account was not found."},404)
      }

      const email=String(targetResult.user.email || "").trim().toLowerCase()
      if(!email.endsWith("@ridearrivo.com")){
        return json({error:"Only @ridearrivo.com accounts may receive workspace password recovery."},400)
      }

      const {error:resetError}=await admin.auth.resetPasswordForEmail(email,{
        redirectTo:"https://intranet.ridearrivo.com/",
      })
      if(resetError){
        console.error("workspace-user-admin password reset",resetError)
        return json({error:`Unable to send recovery email: ${errorMessage(resetError)}`},500)
      }

      await admin.from("admin_audit_log").insert({
        actor_id:administratorId,
        target_employee_id:userId,
        action:"employee.password_reset_requested",
        entity_type:"auth.users",
        entity_id:userId,
        source:"workspace-user-admin",
        metadata:{email},
      }).then(({error})=>{if(error) console.warn("workspace-user-admin audit",error.message)})

      return json({success:true,userId})
    }

    /*
     * APPROVE / UPDATE
     */
    if(
      action==="approve" ||
      action==="update"
    ){
      const userId =
        String(
          body?.userId || ""
        ).trim()

      const role =
        String(
          body?.role ||
          "employee"
        )
          .trim()
          .toLowerCase()

      const department =
        String(
          body?.department ||
          "Unassigned"
        ).trim()

      const jobTitle =
        String(
          body?.jobTitle ||
          ""
        ).trim()

      const suppliedName =
        String(
          body?.fullName ||
          ""
        ).trim()

      const managerId =
        String(
          body?.managerId ||
          ""
        ).trim() || null

      if(!userId){
        return json(
          {
            error:
              "Employee user ID is required.",
          },
          400
        )
      }

      if(
        !VALID_ROLES.has(role)
      ){
        return json(
          {
            error:
              `Invalid role: ${role}`,
          },
          400
        )
      }

      const {
        data:targetResult,
        error:targetError,
      } =
        await admin.auth.admin
          .getUserById(userId)

      if(
        targetError ||
        !targetResult?.user
      ){
        console.error(
          "workspace-user-admin target user",
          targetError
        )

        return json(
          {
            error:
              "Employee Auth account was not found.",
          },
          404
        )
      }

      const target =
        targetResult.user

      const email =
        String(
          target.email || ""
        )
          .trim()
          .toLowerCase()

      if(
        !email.endsWith(
          "@ridearrivo.com"
        )
      ){
        return json(
          {
            error:
              "Only @ridearrivo.com accounts may be approved.",
          },
          400
        )
      }

      const fullName =
        suppliedName ||
        String(
          target.user_metadata
            ?.full_name || ""
        ).trim() ||
        email.split("@")[0]

      if(managerId===userId){
        return json(
          {error:"An employee cannot be their own manager."},
          400
        )
      }

      if(managerId){
        const {data:managerProfile,error:managerError}=await admin
          .from("employee_profiles")
          .select("id,role,active")
          .eq("id",managerId)
          .maybeSingle()

        if(managerError || !managerProfile || managerProfile.active!==true || !["manager","admin"].includes(String(managerProfile.role || "").toLowerCase())){
          return json(
            {error:"Selected manager must be an active Manager or Admin."},
            400
          )
        }
      }

      const {
        error:profileError,
      } =
        await actorDb
          .from("employee_profiles")
          .upsert(
            {
              id:userId,
              email,
              full_name:fullName,
              role,
              department:
                department ||
                "Unassigned",
              job_title:jobTitle,
              manager_id:managerId,
              active:true,
              updated_at:
                new Date()
                  .toISOString(),
            },
            {
              onConflict:"id",
            }
          )

      if(profileError){
        console.error(
          "workspace-user-admin approve/update",
          profileError
        )

        return json(
          {
            error:
              `Unable to save employee access: ${errorMessage(profileError)}`,
          },
          500
        )
      }

      await admin
        .from("admin_audit_log")
        .insert({
          actor_id:administratorId,
          target_employee_id:userId,
          action:action==="approve"?"employee.approve":"employee.update",
          entity_type:"employee_profiles",
          entity_id:userId,
          source:"workspace-user-admin",
          metadata:{role,department,job_title:jobTitle,manager_id:managerId},
        })
        .then(({error})=>{if(error) console.warn("workspace-user-admin audit",error.message)})

      return json({
        success:true,
        user:{
          id:userId,
          email,
          full_name:fullName,
          role,
          department,
          job_title:jobTitle,
          manager_id:managerId,
          active:true,
        },
      })
    }

    /*
     * REVOKE
     */
    if(action==="revoke"){
      const userId =
        String(
          body?.userId || ""
        ).trim()

      if(!userId){
        return json(
          {
            error:
              "Employee user ID is required.",
          },
          400
        )
      }

      if(
        userId ===
        administratorId
      ){
        return json(
          {
            error:
              "You cannot revoke your own administrator account.",
          },
          400
        )
      }

      const {
        data:updated,
        error:updateError,
      } =
        await actorDb
          .from("employee_profiles")
          .update({
            active:false,
            updated_at:
              new Date()
                .toISOString(),
          })
          .eq("id",userId)
          .select("id")
          .maybeSingle()

      if(updateError){
        console.error(
          "workspace-user-admin revoke",
          updateError
        )

        return json(
          {
            error:
              `Unable to revoke employee access: ${errorMessage(updateError)}`,
          },
          500
        )
      }

      if(!updated){
        return json(
          {
            error:
              "Employee profile was not found.",
          },
          404
        )
      }

      await admin
        .from("admin_audit_log")
        .insert({
          actor_id:administratorId,
          target_employee_id:userId,
          action:"employee.revoke",
          entity_type:"employee_profiles",
          entity_id:userId,
          source:"workspace-user-admin",
          metadata:{active:false},
        })
        .then(({error})=>{if(error) console.warn("workspace-user-admin audit",error.message)})

      return json({
        success:true,
        userId,
      })
    }

    return json(
      {
        error:
          `Unsupported administrator action: ${action}`,
      },
      400
    )

  }catch(error){
    console.error(
      "workspace-user-admin fatal",
      error
    )

    return json(
      {
        error:errorMessage(error),
      },
      500
    )
  }
})
