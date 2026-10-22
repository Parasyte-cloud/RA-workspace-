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

    const callerRole =
      String(
        administrator?.role || ""
      ).toLowerCase()

    const callerIsAdmin =
      callerRole === "admin"

    if(
      !administrator ||
      administrator.active !== true ||
      (!callerIsAdmin && callerRole !== "hr")
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
     * People & HR may permanently delete a former employee. Everything else
     * in this function stays administrator only.
     */
    if(
      !callerIsAdmin &&
      action !== "delete-former"
    ){
      return json(
        {error:"Only an administrator can do that."},
        403
      )
    }

    /*
     * LIST
     */
    if(action==="list"){
      // Read every page. A single page of 200 would silently hide people once
      // the company has more accounts than that.
      const pagedUsers:any[] = []
      let authError:any = null
      for(let page=1;page<=25;page++){
        const {
          data:pageResult,
          error:pageError,
        } =
          await admin.auth.admin.listUsers({
            page,
            perPage:200,
          })

        if(pageError){
          authError = pageError
          break
        }

        const batch = pageResult?.users || []
        pagedUsers.push(...batch)

        if(batch.length < 200) break
      }
      const authResult = {users:pagedUsers}

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
     * INVITE
     *
     * Creates a brand-new @ridearrivo.com Auth account (there is no
     * self-service sign-up in this workspace) and immediately assigns
     * their role/department/job title/manager so they land straight in
     * the correct department workspace instead of sitting in the
     * "Unassigned / employee" default until a second admin step.
     */
    if(action==="invite"){
      const email =
        String(body?.email || "")
          .trim()
          .toLowerCase()

      const fullName =
        String(body?.fullName || "").trim()

      const role =
        String(body?.role || "employee")
          .trim()
          .toLowerCase()

      const department =
        String(body?.department || "Unassigned").trim()

      const jobTitle =
        String(body?.jobTitle || "").trim()

      const managerId =
        String(body?.managerId || "").trim() || null

      if(!email){
        return json({error:"Employee email is required."},400)
      }

      if(!email.endsWith("@ridearrivo.com")){
        return json({error:"Only @ridearrivo.com accounts may be invited."},400)
      }

      if(!fullName){
        return json({error:"Employee full name is required."},400)
      }

      if(!VALID_ROLES.has(role)){
        return json({error:`Invalid role: ${role}`},400)
      }

      if(managerId){
        const {
          data:managerProfile,
          error:managerError,
        } =
          await admin
            .from("employee_profiles")
            .select("id,active")
            .eq("id",managerId)
            .maybeSingle()

        if(managerError){
          console.error(
            "workspace-user-admin invite manager lookup",
            managerError
          )

          return json(
            {error:`Unable to verify the reporting manager: ${errorMessage(managerError)}`},
            500
          )
        }

        if(!managerProfile || managerProfile.active!==true){
          return json(
            {error:"Selected reporting manager must have active workspace access."},
            400
          )
        }
      }

      const {
        data:inviteResult,
        error:inviteError,
      } =
        await admin.auth.admin.inviteUserByEmail(
          email,
          {
            data:{full_name:fullName},
            redirectTo:"https://intranet.ridearrivo.com/",
          }
        )

      if(inviteError || !inviteResult?.user){
        console.error(
          "workspace-user-admin invite",
          inviteError
        )

        return json(
          {error:`Unable to invite employee: ${errorMessage(inviteError)}`},
          400
        )
      }

      const userId = inviteResult.user.id

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
              department:department || "Unassigned",
              job_title:jobTitle,
              manager_id:managerId,
              active:true,
              updated_at:new Date().toISOString(),
            },
            {onConflict:"id"}
          )

      if(profileError){
        console.error(
          "workspace-user-admin invite profile",
          profileError
        )

        return json(
          {error:`Invitation was sent, but saving the employee profile failed: ${errorMessage(profileError)}`},
          500
        )
      }

      await admin
        .from("admin_audit_log")
        .insert({
          actor_id:administratorId,
          target_employee_id:userId,
          action:"employee.invite",
          entity_type:"employee_profiles",
          entity_id:userId,
          source:"workspace-user-admin",
          metadata:{email,role,department,job_title:jobTitle,manager_id:managerId},
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
        const {
          data:managerProfile,
          error:managerError,
        } =
          await admin
            .from("employee_profiles")
            .select(
              "id,email,full_name,role,department,job_title,manager_id,active"
            )
            .eq("id",managerId)
            .maybeSingle()

        if(managerError){
          console.error(
            "workspace-user-admin manager lookup",
            managerError
          )

          return json(
            {
              error:
                `Unable to verify the reporting manager: ${errorMessage(managerError)}`,
            },
            500
          )
        }

        if(!managerProfile){
          return json(
            {
              error:
                "Selected reporting manager was not found.",
            },
            400
          )
        }

        if(managerProfile.active!==true){
          return json(
            {
              error:
                "Selected reporting manager must have active workspace access.",
            },
            400
          )
        }

        /*
         * Reporting hierarchy and global Workspace role are
         * deliberately separate concepts.
         *
         * Any active employee may be a line manager. Selecting
         * them here does not grant the company-wide "manager"
         * role or its broader permissions.
         *
         * Walk the candidate's current reporting chain before
         * saving so A -> B -> A (or a deeper cycle) is rejected.
         */
        let hierarchyCursor =
          managerProfile.manager_id
            ? String(
                managerProfile.manager_id
              )
            : null

        const visitedManagerIds =
          new Set<string>([
            managerId,
          ])

        for(
          let depth=0;
          hierarchyCursor && depth<200;
          depth+=1
        ){
          if(
            hierarchyCursor===userId
          ){
            return json(
              {
                error:
                  "This reporting assignment would create a management cycle.",
              },
              400
            )
          }

          if(
            visitedManagerIds.has(
              hierarchyCursor
            )
          ){
            return json(
              {
                error:
                  "The existing reporting hierarchy contains a cycle and must be corrected first.",
              },
              400
            )
          }

          visitedManagerIds.add(
            hierarchyCursor
          )

          const {
            data:parentProfile,
            error:parentError,
          } =
            await admin
              .from(
                "employee_profiles"
              )
              .select(
                "id,manager_id"
              )
              .eq(
                "id",
                hierarchyCursor
              )
              .maybeSingle()

          if(parentError){
            console.error(
              "workspace-user-admin reporting hierarchy",
              parentError
            )

            return json(
              {
                error:
                  `Unable to verify the reporting hierarchy: ${errorMessage(parentError)}`,
              },
              500
            )
          }

          if(!parentProfile){
            hierarchyCursor=null
            break
          }

          hierarchyCursor =
            parentProfile.manager_id
              ? String(
                  parentProfile.manager_id
                )
              : null
        }

        if(hierarchyCursor){
          return json(
            {
              error:
                "Reporting hierarchy is too deep to validate safely.",
            },
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

      /*
       * A revoked person is banned at the Auth layer (see REVOKE below), so a
       * re-approval has to lift that ban or they could never sign in again.
       * Best effort: a failure here is logged and reported, not fatal.
       */
      const unban=await admin.auth.admin.updateUserById(userId,{ban_duration:"none"})
      if(unban.error) console.warn("workspace-user-admin unban",unban.error.message)

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

      /*
       * Setting active=false only changes what the database lets this person
       * do. Their refresh token would keep minting new access tokens for as
       * long as it lives, so also ban the Auth user. A banned user cannot
       * refresh or sign in; an access token already issued stops working on
       * its own within the token lifetime, and the database already refuses
       * it because the profile is inactive. Approving again lifts the ban.
       * A failure is reported to the administrator, who can retry.
       */
      const ban=await admin.auth.admin.updateUserById(userId,{ban_duration:"876000h"})
      if(ban.error) console.warn("workspace-user-admin revoke ban",ban.error.message)

      await admin
        .from("admin_audit_log")
        .insert({
          actor_id:administratorId,
          target_employee_id:userId,
          action:"employee.revoke",
          entity_type:"employee_profiles",
          entity_id:userId,
          source:"workspace-user-admin",
          metadata:{active:false,sessions_blocked:!ban.error},
        })
        .then(({error})=>{if(error) console.warn("workspace-user-admin audit",error.message)})

      return json({
        success:true,
        userId,
        sessionsBlocked:!ban.error,
      })
    }

    /*
     * DELETE PENDING
     *
     * Permanently removes a sign-up that was never approved. Refused when:
     *  - the target is the caller,
     *  - the profile is active (use Revoke instead),
     *  - the account was ever approved (a former employee keeps their
     *    record so history and audit trails stay intact).
     * An audit row is written first, because the target's profile (and its
     * cascade) disappears with the Auth user.
     */
    if(action==="delete-pending"){
      const userId =
        String(
          body?.userId || ""
        ).trim()

      if(!/^[0-9a-f-]{36}$/i.test(userId)){
        return json(
          {error:"A valid user ID is required."},
          400
        )
      }

      if(userId===administratorId){
        return json(
          {error:"You cannot delete your own account."},
          400
        )
      }

      const {
        data:target,
        error:targetError,
      } =
        await admin
          .from("employee_profiles")
          .select("id,email,full_name,active")
          .eq("id",userId)
          .maybeSingle()

      if(targetError){
        console.error(
          "workspace-user-admin delete-pending lookup",
          targetError
        )
        return json(
          {error:`Unable to look up the account: ${errorMessage(targetError)}`},
          500
        )
      }

      if(target?.active===true){
        return json(
          {error:"This account is active. Revoke access instead of deleting it."},
          409
        )
      }

      const {
        data:approvalRows,
        error:approvalError,
      } =
        await admin
          .from("admin_audit_log")
          .select("id")
          .eq("target_employee_id",userId)
          .eq("action","employee.approve")
          .limit(1)

      if(approvalError){
        console.error(
          "workspace-user-admin delete-pending approval check",
          approvalError
        )
        const detail =
          [approvalError.code,approvalError.message,approvalError.details,approvalError.hint]
            .filter(Boolean)
            .join(" | ") || "no detail returned"
        return json(
          {error:`Unable to confirm this account was never approved (${detail}). Nothing was deleted.`},
          500
        )
      }

      const approvals = approvalRows?.length || 0

      if(approvals>0){
        return json(
          {error:"This account was approved before, so it is kept as a former employee record. Nothing was deleted."},
          409
        )
      }

      const {error:auditError}=
        await admin
          .from("admin_audit_log")
          .insert({
            actor_id:administratorId,
            target_employee_id:null,
            action:"employee.delete_pending",
            entity_type:"employee_profiles",
            entity_id:userId,
            source:"workspace-user-admin",
            metadata:{
              email:target?.email || null,
              full_name:target?.full_name || null,
            },
          })

      if(auditError){
        console.error(
          "workspace-user-admin delete-pending audit",
          auditError
        )
        return json(
          {error:`Could not write the audit record (${[auditError.code,auditError.message,auditError.details].filter(Boolean).join(" | ") || "no detail returned"}). Nothing was deleted.`},
          500
        )
      }

      const {error:deleteError}=
        await admin.auth.admin.deleteUser(userId)

      if(deleteError){
        console.error(
          "workspace-user-admin delete-pending",
          deleteError
        )
        return json(
          {error:`Unable to delete the account: ${errorMessage(deleteError)}`},
          500
        )
      }

      return json({success:true,userId})
    }

    /*
     * DELETE FORMER
     *
     * Permanently removes a former employee (People & HR or administrator).
     * Refused when the target is the caller, is still active (archive first),
     * or is an administrator (change their role first). The audit row is
     * written before the Auth user is deleted, because the profile and its
     * cascade disappear with it. A person whose work history is still
     * referenced elsewhere cannot be erased and stays as a former employee.
     */
    if(action==="delete-former"){
      const userId =
        String(
          body?.userId || ""
        ).trim()

      if(!/^[0-9a-f-]{36}$/i.test(userId)){
        return json(
          {error:"A valid user ID is required."},
          400
        )
      }

      if(userId===administratorId){
        return json(
          {error:"You cannot delete your own account."},
          400
        )
      }

      const {
        data:former,
        error:formerError,
      } =
        await admin
          .from("employee_profiles")
          .select("id,email,full_name,active,role,department,job_title")
          .eq("id",userId)
          .maybeSingle()

      if(formerError){
        console.error(
          "workspace-user-admin delete-former lookup",
          formerError
        )
        return json(
          {error:`Unable to look up the account: ${errorMessage(formerError)}`},
          500
        )
      }

      if(!former){
        return json(
          {error:"Employee profile was not found."},
          404
        )
      }

      if(former.active===true){
        return json(
          {error:"This person is still active. Offboard them first, then delete."},
          409
        )
      }

      if(String(former.role).toLowerCase()==="admin"){
        return json(
          {error:"An administrator cannot be deleted. Change their role first."},
          409
        )
      }

      const {error:formerAuditError}=
        await admin
          .from("admin_audit_log")
          .insert({
            actor_id:administratorId,
            target_employee_id:null,
            action:"employee.delete_former",
            entity_type:"employee_profiles",
            entity_id:userId,
            source:"workspace-user-admin",
            metadata:{
              email:former.email || null,
              full_name:former.full_name || null,
              department:former.department || null,
              job_title:former.job_title || null,
            },
          })

      if(formerAuditError){
        console.error(
          "workspace-user-admin delete-former audit",
          formerAuditError
        )
        return json(
          {error:`Could not write the audit record (${[formerAuditError.code,formerAuditError.message,formerAuditError.details].filter(Boolean).join(" | ") || "no detail returned"}). Nothing was deleted.`},
          500
        )
      }

      const {error:formerDeleteError}=
        await admin.auth.admin.deleteUser(userId)

      if(formerDeleteError){
        console.error(
          "workspace-user-admin delete-former",
          formerDeleteError
        )

        await admin
          .from("admin_audit_log")
          .insert({
            actor_id:administratorId,
            target_employee_id:userId,
            action:"employee.delete_former_failed",
            entity_type:"employee_profiles",
            entity_id:userId,
            source:"workspace-user-admin",
            metadata:{reason:errorMessage(formerDeleteError)},
          })
          .then(({error})=>{if(error) console.warn("workspace-user-admin audit",error.message)})

        return json(
          {error:`Could not delete this person: ${errorMessage(formerDeleteError)}. This usually means their work history is still linked to other records, so they are kept as a former employee.`},
          409
        )
      }

      return json({success:true,userId})
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
