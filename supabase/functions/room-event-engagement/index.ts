import {
  createClient,
} from "npm:@supabase/supabase-js@2"

const encoder =
  new TextEncoder()

const allowedOrigins =
  new Set([
    "https://room7.ridearrivo.com",
    "https://intranet.ridearrivo.com",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ])

const publicStates =
  new Set([
    "pre_event",
    "doors_open",
    "live",
    "intermission",
    "ended",
    "replay",
  ])

const qnaSubmitStates =
  new Set([
    "live",
    "intermission",
  ])

const interestTypes =
  new Set([
    "investment",
    "partnership",
    "information",
    "meeting",
  ])

class HttpError extends Error {
  status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.status = status
  }
}

function cors(
  req: Request,
) {
  const origin =
    req.headers.get("Origin") ||
    ""

  const allowedOrigin =
    allowedOrigins.has(origin)
      ? origin
      : "https://room7.ridearrivo.com"

  return {
    "Access-Control-Allow-Origin":
      allowedOrigin,

    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary":
      "Origin",
  }
}

function json(
  req: Request,
  status: number,
  value: unknown,
) {
  return new Response(
    JSON.stringify(value),
    {
      status,

      headers: {
        ...cors(req),

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",
      },
    },
  )
}

function cleanText(
  value: unknown,
  max = 2000,
) {
  if (
    typeof value !==
      "string"
  ) {
    return ""
  }

  return value
    .trim()
    .slice(
      0,
      max,
    )
}

function exactText(
  value: unknown,
  min: number,
  max: number,
  message: string,
) {
  if (
    typeof value !==
      "string"
  ) {
    throw new HttpError(
      400,
      message,
    )
  }

  const text =
    value.trim()

  if (
    text.length < min ||
    text.length > max
  ) {
    throw new HttpError(
      400,
      message,
    )
  }

  return text
}

function cleanEmail(
  value: unknown,
) {
  const email =
    cleanText(
      value,
      320,
    )
      .toLowerCase()

  if (!email) {
    return ""
  }

  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    return ""
  }

  return email
}

function cleanName(
  value: unknown,
) {
  return cleanText(
    value,
    180,
  )
    .replace(
      /\s+/g,
      " ",
    )
}

async function sha256Hex(
  value: string,
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(value),
    )

  return Array.from(
    new Uint8Array(
      digest,
    ),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0",
          ),
    )
    .join("")
}

async function hmacSha256Hex(
  value: string,
  keyValue: string,
) {
  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(
        keyValue,
      ),
      {
        name:
          "HMAC",

        hash:
          "SHA-256",
      },
      false,
      [
        "sign",
      ],
    )

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        value,
      ),
    )

  return Array.from(
    new Uint8Array(
      signature,
    ),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0",
          ),
    )
    .join("")
}

function constantTimeEqual(
  left: string,
  right: string,
) {
  if (
    left.length !==
      right.length
  ) {
    return false
  }

  let difference = 0

  for (
    let index = 0;
    index < left.length;
    index += 1
  ) {
    difference |=
      left.charCodeAt(index) ^
      right.charCodeAt(index)
  }

  return difference === 0
}

async function readBody(
  req: Request,
) {
  const raw =
    await req.text()

  if (
    encoder
      .encode(raw)
      .byteLength >
    16 * 1024
  ) {
    throw new HttpError(
      413,
      "ROOM 7 request is too large.",
    )
  }

  if (!raw.trim()) {
    return {}
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(
      400,
      "Invalid ROOM 7 request.",
    )
  }
}

async function resolvePublicRoom(
  admin: ReturnType<
    typeof createClient
  >,
  body: any,
) {
  const slug =
    cleanText(
      body?.slug,
      80,
    )
      .toLowerCase()

  const roomCode =
    cleanText(
      body?.room_code ||
      body?.roomCode,
      32,
    )
      .toUpperCase()

  let room: any = null
  let external: any = null

  if (slug) {
    const {
      data,
      error,
    } =
      await admin
        .from(
          "room7_external_rooms",
        )
        .select(
          "room_id,slug,access_mode,event_state,public_enabled,passcode_hash",
        )
        .eq(
          "slug",
          slug,
        )
        .maybeSingle()

    if (error) {
      throw error
    }

    external = data

    if (external) {
      const {
        data:
          roomData,

        error:
          roomError,
      } =
        await admin
          .from(
            "workspace_rooms",
          )
          .select(
            "id,room_code,title,status",
          )
          .eq(
            "id",
            external.room_id,
          )
          .maybeSingle()

      if (roomError) {
        throw roomError
      }

      room = roomData
    }
  } else if (roomCode) {
    const {
      data:
        roomData,

      error:
        roomError,
    } =
      await admin
        .from(
          "workspace_rooms",
        )
        .select(
          "id,room_code,title,status",
        )
        .eq(
          "room_code",
          roomCode,
        )
        .maybeSingle()

    if (roomError) {
      throw roomError
    }

    room = roomData

    if (room) {
      const {
        data,
        error,
      } =
        await admin
          .from(
            "room7_external_rooms",
          )
          .select(
            "room_id,slug,access_mode,event_state,public_enabled,passcode_hash",
          )
          .eq(
            "room_id",
            room.id,
          )
          .maybeSingle()

      if (error) {
        throw error
      }

      external = data
    }
  } else {
    throw new HttpError(
      400,
      "ROOM 7 event locator is required.",
    )
  }

  if (
    !room ||
    !external ||
    external.public_enabled !==
      true
  ) {
    throw new HttpError(
      404,
      "ROOM 7 event is unavailable.",
    )
  }

  return {
    room,
    external,
  }
}

async function eventContent(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_content",
      )
      .select(
        [
          "story_headline",
          "story_body",
          "story_points",
          "programme_items",
          "invest_headline",
          "invest_body",
          "invest_cta_label",
          "qna_enabled",
          "investor_interest_enabled",
          "updated_at",
        ].join(","),
      )
      .eq(
        "room_id",
        roomId,
      )
      .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function existingGuestByInvitation(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  invitationId: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_guest_participants",
      )
      .select("id")
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "invitation_id",
        invitationId,
      )
      .limit(1)
      .maybeSingle()

  if (error) {
    throw error
  }

  return data?.id || null
}

async function existingGuestByEmail(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  email: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_guest_participants",
      )
      .select("id")
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "email",
        email,
      )
      .limit(1)
      .maybeSingle()

  if (error) {
    throw error
  }

  return data?.id || null
}

async function requireGuestAccess(
  admin: ReturnType<
    typeof createClient
  >,
  room: any,
  external: any,
  body: any,
) {
  const inputName =
    cleanName(
      body?.display_name ||
      body?.displayName ||
      body?.name,
    )

  const inputEmail =
    cleanEmail(
      body?.email,
    )

  if (
    external.access_mode ===
      "invitation"
  ) {
    const token =
      cleanText(
        body?.invite_token ||
        body?.inviteToken,
        512,
      )

    if (
      token.length < 24
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation is required.",
      )
    }

    const tokenHash =
      await sha256Hex(
        token,
      )

    const {
      data:
        invitation,

      error:
        invitationError,
    } =
      await admin
        .from(
          "room7_guest_invitations",
        )
        .select(
          "id,email,display_name,status,expires_at",
        )
        .eq(
          "room_id",
          room.id,
        )
        .eq(
          "token_hash",
          tokenHash,
        )
        .maybeSingle()

    if (invitationError) {
      throw invitationError
    }

    if (
      !invitation ||
      invitation.status !==
        "active"
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation is invalid or unavailable.",
      )
    }

    if (
      invitation.expires_at &&
      new Date(
        invitation.expires_at,
      ).getTime() <=
        Date.now()
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation has expired.",
      )
    }

    const invitedEmail =
      cleanEmail(
        invitation.email,
      )

    if (
      invitedEmail &&
      inputEmail !==
        invitedEmail
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation email does not match.",
      )
    }

    const email =
      invitedEmail ||
      inputEmail

    if (!email) {
      throw new HttpError(
        400,
        "Enter a valid email address.",
      )
    }

    const displayName =
      cleanName(
        invitation
          .display_name,
      ) ||
      inputName

    if (!displayName) {
      throw new HttpError(
        400,
        "Enter your name.",
      )
    }

    const guestId =
      await existingGuestByInvitation(
        admin,
        room.id,
        invitation.id,
      )

    return {
      displayName,
      email,
      invitationId:
        invitation.id,

      guestId,

      source:
        "invitation",
    }
  }

  if (!inputName) {
    throw new HttpError(
      400,
      "Enter your name.",
    )
  }

  if (!inputEmail) {
    throw new HttpError(
      400,
      "Enter a valid email address.",
    )
  }

  if (
    external.access_mode ===
      "passcode"
  ) {
    const passcode =
      cleanText(
        body?.passcode,
        256,
      )

    if (
      passcode.length < 6
    ) {
      throw new HttpError(
        401,
        "ROOM 7 passcode is required.",
      )
    }

    const pepper =
      cleanText(
        Deno.env.get(
          "ROOM7_ACCESS_PEPPER",
        ),
        512,
      )

    if (!pepper) {
      throw new HttpError(
        503,
        "ROOM 7 passcode access is unavailable.",
      )
    }

    const expectedHash =
      cleanText(
        external
          .passcode_hash,
        64,
      )

    const suppliedHash =
      await hmacSha256Hex(
        passcode,
        pepper,
      )

    if (
      !expectedHash ||
      !constantTimeEqual(
        suppliedHash,
        expectedHash,
      )
    ) {
      throw new HttpError(
        401,
        "ROOM 7 passcode is incorrect.",
      )
    }

    const guestId =
      await existingGuestByEmail(
        admin,
        room.id,
        inputEmail,
      )

    return {
      displayName:
        inputName,

      email:
        inputEmail,

      invitationId:
        null,

      guestId,

      source:
        "passcode",
    }
  }

  if (
    external.access_mode ===
      "open"
  ) {
    if (
      Deno.env.get(
        "ROOM7_ALLOW_OPEN_ACCESS",
      ) !==
        "true"
    ) {
      throw new HttpError(
        403,
        "Open ROOM 7 access is disabled.",
      )
    }

    const guestId =
      await existingGuestByEmail(
        admin,
        room.id,
        inputEmail,
      )

    return {
      displayName:
        inputName,

      email:
        inputEmail,

      invitationId:
        null,

      guestId,

      source:
        "open",
    }
  }

  throw new HttpError(
    403,
    "ROOM 7 guest access is unavailable.",
  )
}

Deno.serve(
  async (
    req: Request,
  ) => {
    if (
      req.method ===
        "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status:
            204,

          headers:
            cors(req),
        },
      )
    }

    if (
      req.method !==
        "POST"
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
        await readBody(
          req,
        )

      const action =
        cleanText(
          body?.action,
          80,
        )

      if (
        ![
          "public_content",
          "public_questions",
          "submit_question",
          "submit_interest",
        ].includes(
          action,
        )
      ) {
        throw new HttpError(
          400,
          "Unsupported ROOM 7 engagement action.",
        )
      }

      const supabaseUrl =
        Deno.env.get(
          "SUPABASE_URL",
        )

      const serviceRoleKey =
        Deno.env.get(
          "SUPABASE_SERVICE_ROLE_KEY",
        )

      if (
        !supabaseUrl ||
        !serviceRoleKey
      ) {
        throw new HttpError(
          503,
          "ROOM 7 engagement is not configured.",
        )
      }

      const admin =
        createClient(
          supabaseUrl,
          serviceRoleKey,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false,
            },
          },
        )

      const {
        room,
        external,
      } =
        await resolvePublicRoom(
          admin,
          body,
        )

      const content =
        await eventContent(
          admin,
          room.id,
        )

      const qnaEnabled =
        content
          ?.qna_enabled !==
        false

      const investorEnabled =
        content
          ?.investor_interest_enabled !==
        false

      if (
        action ===
          "public_content"
      ) {
        return json(
          req,
          200,
          {
            content:
              content
                ? {
                    story_headline:
                      content
                        .story_headline,

                    story_body:
                      content
                        .story_body,

                    story_points:
                      content
                        .story_points,

                    programme_items:
                      content
                        .programme_items,

                    invest_headline:
                      content
                        .invest_headline,

                    invest_body:
                      content
                        .invest_body,

                    invest_cta_label:
                      content
                        .invest_cta_label,

                    updated_at:
                      content
                        .updated_at,
                  }
                : null,

            features: {
              qna_enabled:
                qnaEnabled,

              investor_interest_enabled:
                investorEnabled,
            },
          },
        )
      }

      if (
        action ===
          "public_questions"
      ) {
        if (!qnaEnabled) {
          return json(
            req,
            200,
            {
              questions:
                [],
            },
          )
        }

        const {
          data:
            questions,

          error:
            questionError,
        } =
          await admin
            .from(
              "room7_event_questions",
            )
            .select(
              "id,question,status,answer_text,is_pinned,submitted_at,answered_at",
            )
            .eq(
              "room_id",
              room.id,
            )
            .in(
              "status",
              [
                "approved",
                "answered",
              ],
            )
            .order(
              "is_pinned",
              {
                ascending:
                  false,
              },
            )
            .order(
              "submitted_at",
              {
                ascending:
                  true,
              },
            )
            .limit(100)

        if (questionError) {
          throw questionError
        }

        return json(
          req,
          200,
          {
            questions:
              questions ||
              [],
          },
        )
      }

      if (
        action ===
          "submit_question"
      ) {
        if (
          room.status !==
            "active" ||
          !qnaSubmitStates.has(
            external.event_state,
          )
        ) {
          throw new HttpError(
            409,
            "Moderated Q&A is not accepting questions right now.",
          )
        }

        if (!qnaEnabled) {
          throw new HttpError(
            403,
            "Moderated Q&A is disabled for this event.",
          )
        }

        const identity =
          await requireGuestAccess(
            admin,
            room,
            external,
            body,
          )

        const question =
          exactText(
            body?.question,
            3,
            1200,
            "Question must contain between 3 and 1200 characters.",
          )

        const since =
          new Date(
            Date.now() -
            10 * 60 * 1000,
          )
            .toISOString()

        const {
          count,
          error:
            rateError,
        } =
          await admin
            .from(
              "room7_event_questions",
            )
            .select(
              "id",
              {
                count:
                  "exact",

                head:
                  true,
              },
            )
            .eq(
              "room_id",
              room.id,
            )
            .eq(
              "email",
              identity.email,
            )
            .gte(
              "submitted_at",
              since,
            )

        if (rateError) {
          throw rateError
        }

        if (
          (count || 0) >=
          5
        ) {
          throw new HttpError(
            429,
            "Please wait before submitting another ROOM 7 question.",
          )
        }

        const {
          data:
            inserted,

          error:
            insertError,
        } =
          await admin
            .from(
              "room7_event_questions",
            )
            .insert({
              room_id:
                room.id,

              invitation_id:
                identity
                  .invitationId,

              guest_id:
                identity
                  .guestId,

              display_name:
                identity
                  .displayName,

              email:
                identity.email,

              question,

              status:
                "pending",
            })
            .select(
              "id,status,submitted_at",
            )
            .single()

        if (insertError) {
          throw insertError
        }

        return json(
          req,
          201,
          {
            question: {
              id:
                inserted.id,

              status:
                inserted.status,

              submitted_at:
                inserted
                  .submitted_at,
            },

            message:
              "Your question was submitted for moderator review.",
          },
        )
      }

      if (
        action ===
          "submit_interest"
      ) {
        if (
          !publicStates.has(
            external.event_state,
          )
        ) {
          throw new HttpError(
            409,
            "Investor and stakeholder follow-up is not available right now.",
          )
        }

        if (!investorEnabled) {
          throw new HttpError(
            403,
            "Investor and stakeholder follow-up is disabled for this event.",
          )
        }

        const identity =
          await requireGuestAccess(
            admin,
            room,
            external,
            body,
          )

        if (
          body
            ?.contact_consent !==
          true
        ) {
          throw new HttpError(
            400,
            "Contact consent is required before submitting your interest.",
          )
        }

        const interestType =
          cleanText(
            body
              ?.interest_type,
            40,
          )
            .toLowerCase()

        if (
          !interestTypes.has(
            interestType,
          )
        ) {
          throw new HttpError(
            400,
            "Select a valid area of interest.",
          )
        }

        const company =
          cleanText(
            body?.company,
            180,
          )

        const phone =
          cleanText(
            body?.phone,
            40,
          )

        const investmentRange =
          cleanText(
            body
              ?.investment_range,
            120,
          )

        const message =
          cleanText(
            body?.message,
            2000,
          )

        const {
          data:
            existing,

          error:
            existingError,
        } =
          await admin
            .from(
              "room7_investor_interest",
            )
            .select(
              "id,last_submitted_at",
            )
            .eq(
              "room_id",
              room.id,
            )
            .eq(
              "email",
              identity.email,
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
            30_000
        ) {
          throw new HttpError(
            429,
            "Please wait before submitting follow-up information again.",
          )
        }

        let submission:
          any

        if (existing) {
          const {
            data:
              updated,

            error:
              updateError,
          } =
            await admin
              .from(
                "room7_investor_interest",
              )
              .update({
                invitation_id:
                  identity
                    .invitationId,

                guest_id:
                  identity
                    .guestId,

                display_name:
                  identity
                    .displayName,

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
                  "room7-event-contact-v1",

                consent_at:
                  now.toISOString(),

                last_submitted_at:
                  now.toISOString(),
              })
              .eq(
                "id",
                existing.id,
              )
              .eq(
                "room_id",
                room.id,
              )
              .select(
                "id,last_submitted_at",
              )
              .single()

          if (updateError) {
            throw updateError
          }

          submission =
            updated
        } else {
          const {
            data:
              inserted,

            error:
              insertError,
          } =
            await admin
              .from(
                "room7_investor_interest",
              )
              .insert({
                room_id:
                  room.id,

                invitation_id:
                  identity
                    .invitationId,

                guest_id:
                  identity
                    .guestId,

                display_name:
                  identity
                    .displayName,

                email:
                  identity.email,

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
                  "room7-event-contact-v1",

                consent_at:
                  now.toISOString(),

                last_submitted_at:
                  now.toISOString(),
              })
              .select(
                "id,last_submitted_at",
              )
              .single()

          if (insertError) {
            throw insertError
          }

          submission =
            inserted
        }

        return json(
          req,
          201,
          {
            submission_id:
              submission.id,

            received_at:
              submission
                .last_submitted_at,

            message:
              "Your ROOM 7 follow-up request has been received.",
          },
        )
      }

      throw new HttpError(
        400,
        "Unsupported ROOM 7 engagement action.",
      )
    } catch (cause) {
      if (
        cause instanceof
          HttpError
      ) {
        return json(
          req,
          cause.status,
          {
            error:
              cause.message,
          },
        )
      }

      console.error(
        "ROOM 7 engagement failure",
        {
          name:
            cause instanceof
              Error
              ? cause.name
              : "Error",

          message:
            cause instanceof
              Error
              ? cause.message
              : "Unknown error",
        },
      )

      return json(
        req,
        500,
        {
          error:
            "ROOM 7 engagement request failed.",
        },
      )
    }
  },
)
