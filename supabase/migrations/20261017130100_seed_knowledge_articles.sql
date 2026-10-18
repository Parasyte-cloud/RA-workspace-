-- Seed: the first RideArrivo Knowledge Base articles.
--
-- Source of every fact: the workspace code (public forms, membership plans,
-- letterhead, ROOM 7 notes) and details the founder gave directly. Nothing here
-- is invented. Re-running is safe: an article that already exists (same slug)
-- is left exactly as it is, so edits made in the workspace are never overwritten.
-- Source copy lives in supabase/seed/knowledge-articles.json.

begin;

insert into public.workspace_knowledge_articles
  (title, slug, summary, content, category, tags, status, source, last_reviewed_at)
values
  ($kb$About RideArrivo$kb$, $kb$about-ridearrivo$kb$, $kb$Who RideArrivo is, what it sells, and the one-line brand promise.$kb$,
   $kb$## Who we are
RideArrivo Limited is a Lagos, Nigeria transport company. The brand name is written RideArrivo (one word, capital R and A). The tagline is "Arrive Better."

The core product is airport pickups and drop-offs, booked ahead. Around it sits a family of services that cover city rides, removals, chauffeurs, private jets and boats (see "The RideArrivo product family").

## Where we operate
Our home market is Lagos. Interstate removals and charter flights reach other Nigerian cities and a short list of international hubs.

## Official details
- Legal name: RideArrivo Limited
- Website: www.ridearrivo.com
- Email: info@ridearrivo.com
- Phone: +234 816 270 6078 (written 0816 270 6078 on the letterhead)
- Address: Babajide Sanwo-Olu International Market, Ikosi, Lagos, Nigeria
- Time zone for all bookings: Lagos time (WAT, UTC+1, no daylight saving)

## Where to find more
- Products and prices: see the product family and membership articles.
- Brand files and the letterhead: Company, then Brand Library and Letterhead.
- How this workspace works: see "Using the RideArrivo Workspace".$kb$,
   $kb$Company$kb$, array['company','overview','brand']::text[], 'published', 'seed', now()),
  ($kb$Official company contact details$kb$, $kb$company-contact-details$kb$, $kb$The address, phone and email to give customers and partners.$kb$,
   $kb$## Use these, and only these
- Address: Babajide Sanwo-Olu International Market, Ikosi, Lagos, Nigeria
- Phone: +234 816 270 6078
- WhatsApp: +234 816 270 6078
- General email: info@ridearrivo.com
- Website: www.ridearrivo.com

## Copying them
The Letterhead page in this workspace shows the address and phone with a copy button beside each, so nobody retypes them.

## In documents
The letterhead PDF footer prints the phone as 0816 270 6078 and the location as Lagos, Nigeria. Change the details in one place (the letterhead settings in the code) and every generated document follows.

## Late or urgent booking requests
Bookings that are too close to the start time are sent to the support phone, WhatsApp and info@ridearrivo.com. See "Booking notice and late requests".$kb$,
   $kb$Company$kb$, array['contact','address','phone','email']::text[], 'published', 'seed', now()),
  ($kb$The RideArrivo product family$kb$, $kb$ridearrivo-product-family$kb$, $kb$All six services, what each does, and where each one lives online.$kb$,
   $kb$## The six services
- RideArrivo: airport pickups and drop-offs, booked ahead. www.ridearrivo.com
- ArrivoExpress: on-demand rides around the city. express.ridearrivo.com
- ArrivoRemovals: moving and removals with a trained crew. move.ridearrivo.com (this was called Move or ArrivoMove before; the new name is ArrivoRemovals)
- ArrivoChauffeur: a private chauffeur for events and charters. www.ridearrivo.com/charter-booking.html
- ArrivoAir: air travel and private jet charter. air.ridearrivo.com
- ArrivoBoat: boat and water transfers. boat.ridearrivo.com

## Status
Internally, RideArrivo and ArrivoExpress are live. ArrivoRemovals, ArrivoAir and ArrivoBoat were recorded as in development, each on its own subdomain. Check with Operations before promising a date to a customer.

## Naming rules
- Airport pickup and drop-off belongs to RideArrivo itself, not ArrivoExpress.
- Use the new name ArrivoRemovals, not Move or ArrivoMove, in anything customer-facing.
- The family is shown in the ROOM 7 top bar from one list in the code (room7Products), so a rename is a one-line change.

## How booking differs
- ArrivoExpress: the rider signs in, fills the form, and gets a payment link by text. The ride is confirmed when it is paid.
- ArrivoRemovals, ArrivoAir, ArrivoBoat: the customer sends a request. A member of the team confirms the exact price before anything is booked.$kb$,
   $kb$Products$kb$, array['products','services','subdomains']::text[], 'published', 'seed', now()),
  ($kb$RideArrivo airport pickups and drop-offs$kb$, $kb$ridearrivo-airport-pickups$kb$, $kb$The core RideArrivo service and the airports it connects to.$kb$,
   $kb$## What it is
Airport pickups and drop-offs, booked ahead, in Lagos. This is the original RideArrivo product and the one the tagline "Arrive Better." describes.

## Lagos airport
Murtala Muhammed International Airport (LOS) is the home airport.

## Members
Executive members get an airport pickup fast-track with meet and greet. See "Membership plans".

## Booking notice
Online bookings need at least 12 hours notice. Sooner than that goes to support. See "Booking notice and late requests".

## Support tools
Support staff work from the Support workstation: Orders Console, Live Trips, Panic Alerts, Rider Directory, Driver Directory, Refunds and Disputes.$kb$,
   $kb$Products$kb$, array['airport','pickup','core']::text[], 'published', 'seed', now()),
  ($kb$ArrivoExpress: on-demand city rides$kb$, $kb$arrivoexpress$kb$, $kb$How an ArrivoExpress booking works from sign-in to payment.$kb$,
   $kb$## What it is
On-demand rides around the city, at express.ridearrivo.com.

## The booking steps
1. The rider signs in.
2. The rider fills in the ride details.
3. The system texts a payment link.
4. The ride is confirmed as soon as it is paid.

## Payment
Payment runs through Paystack. A booking only becomes real once Paystack's webhook confirms a real payment. Until then it is a pending booking, so nobody is dispatched for an unpaid ride.

## Duplicate protection
Submitting twice (double click or a retry after a network hiccup) must not create two bookings. Check for an existing pending booking before creating another by hand.

## Not included
Airport pickup and drop-off is a RideArrivo service, not ArrivoExpress.$kb$,
   $kb$Products$kb$, array['express','rides','payments']::text[], 'published', 'seed', now()),
  ($kb$ArrivoRemovals: moving and removals$kb$, $kb$arrivoremovals$kb$, $kb$What the removals service covers and what the booking form asks.$kb$,
   $kb$## What it is
A truck, a careful crew and one point of contact for the whole move, from a single room to a full house or office relocation. The customer sees a starting price estimate before committing.

## What is included
One booking covers loading, transport and unloading by a vetted removal crew.

## What the form collects
- Move date and a time window: Morning (8am to 12pm), Afternoon (12pm to 4pm) or Evening (4pm to 8pm)
- Area: Lekki / Ajah, Victoria Island / Ikoyi, Ikeja / Mainland, Festac / Amuwo, Surulere / Yaba, Makoko, Interstate, Other
- Property size: Single Room / Self-Contain, Studio / 1 Bedroom Flat, 2 Bedroom Flat, 3 Bedroom Flat, 4+ Bedroom / Duplex, Office / Commercial Space
- Access: ground floor or drive-up, upper floor with elevator, upper floor walk-up
- Special items: fragile or glass, piano or heavy furniture, large appliances, other
- Crew: Standard crew (2 movers) or Large crew (4 movers)

## After submitting
The booking goes in for review. The team contacts the customer and confirms. Requests under 12 hours notice follow the late booking rule.$kb$,
   $kb$Products$kb$, array['removals','move','crew']::text[], 'published', 'seed', now()),
  ($kb$ArrivoAir: private jet charter$kb$, $kb$arrivoair$kb$, $kb$How private jet requests work, aircraft classes and the airport list.$kb$,
   $kb$## What it is
Private jets on request. The customer gives route, dates and party size, and the team returns aircraft options and a firm price from a network of vetted operators with licensed aircraft. A member of the team confirms the exact price before booking.

## Trip types
One-way or round trip.

## Aircraft classes shown to customers
- Light jet: short-to-medium hops, up to 6-8 passengers
- Midsize jet: more cabin room, medium-to-long range, up to 8-9 passengers
- Super-midsize jet: stand-up cabin, long range, up to 9-10 passengers
- Heavy jet: long-range and intercontinental, up to 10-16 passengers
- No preference: matched to the trip
The form shows a "Best match" hint from the passenger count but never blocks a choice.

## Airports
The picker is a short hand-picked list: major Nigerian airports (Lagos LOS, Abuja ABV, Port Harcourt PHC, Kano KAN, Enugu ENU, Calabar CBQ and others), West, East and Southern African hubs (Accra, Abidjan, Dakar, Nairobi, Addis Ababa and others) and the usual private-aviation gateways. Free text is always accepted, so a route that is not in the list is never blocked.

## Timing
Departure times are Lagos time. The 12 hour minimum notice applies.$kb$,
   $kb$Products$kb$, array['air','jet','charter']::text[], 'published', 'seed', now()),
  ($kb$ArrivoBoat: boat and yacht charter$kb$, $kb$arrivoboat$kb$, $kb$Vessel types, charter types and how a boat request is handled.$kb$,
   $kb$## What it is
Speedboats, yachts and water taxis on request, with vetted captains and vessels. The team confirms the exact price before the customer books.

## Charter types
- Point-to-point transfer
- Day charter or tour
- Event or celebration
- Fishing charter

## Vessels
- Speedboat: fast, open-air transfers, best for 1-8 passengers
- Yacht: spacious, ideal for day charters and events
- Catamaran: stable twin hull, good for larger groups and calmer rides
- Water taxi: quick, no-frills hops for a small party
- No preference: matched to what is available

## Durations
1-2 hours, half day (up to 4 hours), full day, multi-day.

## Timing
Lagos time. The 12 hour minimum notice applies.$kb$,
   $kb$Products$kb$, array['boat','yacht','charter']::text[], 'published', 'seed', now()),
  ($kb$ArrivoChauffeur: private chauffeur$kb$, $kb$arrivochauffeur$kb$, $kb$The chauffeur product for events and charters.$kb$,
   $kb$## What it is
A private chauffeur for events and charters. Customers book through www.ridearrivo.com/charter-booking.html.

## Naming
The product name is ArrivoChauffeur (the team sometimes shortens it to Chauffeur in app labels).

## Confirm before promising
Pricing and fleet details for the chauffeur product are not recorded in the workspace yet. Ask Operations, then add them here.$kb$,
   $kb$Products$kb$, array['chauffeur','events','charter']::text[], 'published', 'seed', now()),
  ($kb$Membership plans and prices$kb$, $kb$membership-plans$kb$, $kb$All five RideArrivo membership plans with price, kilometres and benefits.$kb$,
   $kb$Prices are per month in Naira, as shown on the membership signup page.

## RideArrivo Plus: ₦120,000 per month
For everyday errands and short commutes.
- 2% of every trip fare back to the RideArrivo wallet
- 300 km per month (about 10 km a day)
- 2-minute free cancellation window
- Referral bonus: wallet credit for you and your friend
- Delivery and courier at standard rates

## RideArrivo Plus+: ₦250,000 per month
Replaces the hassle of a personal driver.
- 2% back to the wallet
- 600 km per month (about 20 km a day)
- Priority pickup queueing at peak times
- 2-minute free cancellation window
- Referral bonus
- Delivery and courier at standard rates

## RideArrivo Premium: ₦650,000 per month
For daily riders and busy households.
- 5% back to the wallet
- 1,800 km per month (about 60 km a day)
- Verified, top-rated drivers only
- Priority customer support queue
- 5-minute free cancellation window
- ₦15,000 wallet bonus in the birthday month
- Discounted delivery and courier
- Referral bonus

## RideArrivo Executive: ₦1,050,000 per month
Status, security and near-unlimited mobility.
- 5% back to the wallet
- 3,000 km per month (about 100 km a day)
- A 5% discount code to share with friends and family (capped use)
- Dedicated safety desk and priority SOS line
- Verified, top-rated drivers only
- Airport pickup fast-track with meet and greet
- Monthly free delivery and courier allowance
- 10-minute free cancellation window
- ₦50,000 wallet bonus in the birthday month

## RideArrivo Corporate: ₦10,000 to ₦15,000 per seat per month
For offices, churches, schools and teams.
- One consolidated monthly invoice
- Admin dashboard to add and remove riders and set spending caps
- Pooled 80 km per seat per month, shared flexibly across the team
- 3% of every trip fare back to a shared organization wallet
- Volume pricing: ₦15,000 per seat (10-24 seats), ₦12,500 (25-49), ₦10,000 (50 and over)
- Optional verified-driver-only routing, recommended for school transport

## How signup works
The customer gives their details, picks a plan, sees its full benefits, and confirms. Corporate signups also give the organization name and an estimated seat count. The request goes to the team, who follow up.$kb$,
   $kb$Products$kb$, array['membership','pricing','plans']::text[], 'published', 'seed', now()),
  ($kb$Booking notice and late requests$kb$, $kb$booking-notice-and-late-requests$kb$, $kb$The 12 hour notice rule, how Lagos time is handled, and who to contact for short-notice jobs.$kb$,
   $kb$## The rule
A standard online booking for Removals, Boat and Air needs at least 12 hours notice. Anything sooner used to be accepted silently, so support found out about a tomorrow-morning job after the fact. Now the form stops the customer and offers the support route instead.

## Lagos time
A date and time typed into the forms is a wall-clock time in Lagos (WAT, UTC+1, no daylight saving), whatever time zone the customer's device is in. This keeps bookings correct for customers abroad.

## Short-notice contacts
- Phone: +234 816 270 6078
- WhatsApp: +234 816 270 6078
- Email: info@ridearrivo.com

## If Operations changes the number of hours
The 12 hour figure lives in three places and they must change together: the booking backend, the website's late-request script and this workspace's forms. If only one changes, one surface will accept what another refuses.$kb$,
   $kb$Policies$kb$, array['policy','bookings','timing']::text[], 'published', 'seed', now()),
  ($kb$Using the RideArrivo Workspace$kb$, $kb$using-the-ridearrivo-workspace$kb$, $kb$What the internal workspace is, what is in it, and how sign-in works.$kb$,
   $kb$## What it is
The RideArrivo Workspace is the internal tool for staff: Support, CRM, Engineering, People and HR, Operations, Finance and Accounting, Marketing, Partnerships, Legal and Administration in one place. It is separate from the rider and driver apps.

## What you will see
Dashboard, Tasks, Chat, Mail, Calendar, My Profile, Projects, ROOM 7, Pulse, Announcements, Company Files, Archive, Brand Library, Letterhead, Blog Studio, Knowledge Base, CRM and the department workstations you have been assigned. What shows in your sidebar depends on your role and workstation assignments.

## Signing in
Only company email addresses are allowed (the default allowed domain is ridearrivo.com).

## Keep me signed in
- Ticked: this device stays signed in, even after you close the app or leave it idle.
- Unticked: you are signed out when the browser or app closes, and after 30 minutes without activity.
- It is a per-device setting. Turn it off on any shared computer. You can change it in Settings.
- A call or meeting that is open counts as activity, so the idle timer will not sign you out of it.

## Installing
The workspace can be installed as an app on a phone or computer. On first sign-in after installing, a card offers to turn on sound for chat messages and calls.

## Getting help
Ask your department lead, or Administration for access problems.$kb$,
   $kb$Workspace$kb$, array['workspace','how-to','modules']::text[], 'published', 'seed', now()),
  ($kb$ROOM 7 meetings and the AI meeting recorder$kb$, $kb$room-7-meetings$kb$, $kb$How ROOM 7 works, guest events, and how the physical meeting recorder treats consent and audio.$kb$,
   $kb$## What ROOM 7 is
The meeting space inside the workspace: rooms, calls, events for outside guests, documents and minutes.

## External guests
Guests open the event link (room7.ridearrivo.com/r/ followed by the 8 character event code), enter an email and, if the host set one, a passcode. Every guest gives an email in every mode, because that is how ROOM 7 knows who attended. A host can also require approval of each guest before they enter.

## AI meeting recorder (physical meetings)
A host can record an in-person meeting from ROOM 7 home. The recorder transcribes the meeting live and produces a final, speaker-labelled transcript afterwards.
- Everyone present is asked for consent before recording starts. Consent is recorded and cannot be edited afterwards.
- The host picks how long the audio is kept: delete after the transcript is ready (the default), 7, 30 or 90 days, or permanent. Deleting audio never deletes the written transcript.
- Only the host manages a session. Hosts and the listed active employees can read the record. The Admin role alone is deliberately not enough to read a record.
- Speakers can be renamed, moments can be marked, and the transcript can be exported as text.

## Legal note
Recording and transcribing people is regulated personal data processing. Counsel should confirm how the Nigeria Data Protection Act 2023 applies (notice wording, retention, cross-border transfer) before production use.$kb$,
   $kb$Workspace$kb$, array['room7','meetings','recording','privacy']::text[], 'published', 'seed', now()),
  ($kb$Support desk tools and escalation$kb$, $kb$support-desk-tools$kb$, $kb$The tools the Support workstation uses and what each is for.$kb$,
   $kb$## The Support workstation
- Orders Console: incoming bookings, assignment status and rider context
- Live Trips: active ride monitoring, driver position and exceptions
- Panic Alerts: safety-critical alerts and escalation
- Rider Directory: rider profile, trip history and support context
- Driver Directory: driver verification, availability and support context
- Refunds and Disputes: payment exceptions and the escalation workflow

## Safety first
Panic Alerts are the safety-critical queue. Members on Premium and Executive get a priority support queue, and Executive members also have a dedicated safety desk and priority SOS line.

## Late bookings
See "Booking notice and late requests" for the 12 hour rule and the contacts customers are given.$kb$,
   $kb$Operations$kb$, array['support','safety','escalation']::text[], 'published', 'seed', now()),
  ($kb$Brand assets and the letterhead$kb$, $kb$brand-and-letterhead-guide$kb$, $kb$Where brand files live, the brand colours, and how to produce a letter on the official letterhead.$kb$,
   $kb$## Names
- Company: RideArrivo Limited. Brand: RideArrivo. Tagline: Arrive Better.
- Services: ArrivoExpress, ArrivoRemovals, ArrivoChauffeur, ArrivoAir, ArrivoBoat.

## Colours used on the letterhead
- Body text ink: #182A40
- Navy for names, labels and subjects: #001B3E
- Amber for header and footer rules: #FF8A00
- Muted grey-blue for tagline and small labels: #657184

## Files
Wordmarks and logos are in Company, then Brand Library. The official letterhead logo is a separate file used only by the letterhead tool.

## Making a letter
Open Company, then Letterhead. Pick a kind (letter, email, memo or notice), type or paste the content, and download an A4 PDF. Everything is laid out in your browser and nothing you type is uploaded. The company address and phone are shown at the top with copy buttons.$kb$,
   $kb$Company$kb$, array['brand','letterhead','design']::text[], 'published', 'seed', now()),
  ($kb$Engineering and deployment overview$kb$, $kb$engineering-and-deployment-overview$kb$, $kb$The stack behind the workspace and how a change reaches production.$kb$,
   $kb$## Stack
React and TypeScript on Vite, deployed to Cloudflare Pages. Supabase provides authentication, the Postgres database (with row level security) and edge functions. The app is a PWA.

## How a change ships
1. Work happens on a branch and goes in as a pull request.
2. CI runs the typecheck, the tests, the build and a high-severity dependency audit on every pull request.
3. After the pull request is approved and merged to main, Cloudflare Pages deploys automatically.
4. Database changes are migrations in supabase/migrations, applied with supabase db push. Edge functions are deployed with supabase functions deploy.

## Secrets
Secrets are Supabase function secrets or Cloudflare variables. They never go in the repository or in chat.

## More detail
The repository has DEPLOYMENT_GUIDE, ARCHITECTURE_AUDIT and ENGINEERING_SECURITY_AUDIT files, plus notes for push notifications and ROOM 7.$kb$,
   $kb$Engineering$kb$, array['engineering','stack','deploy']::text[], 'published', 'seed', now())
on conflict (slug) do nothing;

commit;
