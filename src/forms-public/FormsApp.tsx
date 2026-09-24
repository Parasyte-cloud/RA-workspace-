import { RideArrivoExactLogo } from './RideArrivoLogo'
import InvestorInterestForm from './InvestorInterestForm'
import PublicIntakeForm from './PublicIntakeForm'
import MembershipApp from './MembershipApp'
import MoveApp from './MoveApp'
import './forms-public.css'

/*
 * Entry point for the forms.ridearrivo.com surface (see the
 * isPublicFormsSurface() check in main.tsx). Originally this file WAS the
 * investor-interest form; it's now a small router so any form published
 * through the reusable intake platform can get its own path here without
 * the investor form having to share a component with it.
 *
 *   /                -> investor & stakeholder interest (unchanged,
 *                        still posts to the ridearrivo-public-forms
 *                        edge function, kept at the root so any existing
 *                        links to forms.ridearrivo.com keep working)
 *   /investor         -> same, explicit path
 *   /contact-us       -> general contact form (intake platform, slug
 *                        "contact-us")
 *   /charter-booking  -> charter & flagged-destination booking request
 *                        (intake platform, slug "charter-booking")
 *
 * Both intake routes render the same PublicIntakeForm, which fetches its
 * field schema by slug from the intake edge function. Adding another
 * form later (through the eventual admin UI, or another SQL seed) only
 * needs a new route added here, not a new page built from scratch.
 *
 * bookings.ridearrivo.com (see isPublicFormsSurface() in main.tsx) is a
 * dedicated subdomain for the charter-booking form specifically, meant
 * for a short, clean link in an Instagram bio / social profile. It
 * always renders the charter-booking form regardless of path, so any
 * link to the bare domain (or any path on it) works, rather than
 * requiring the visitor land on the exact /charter-booking path.
 *
 * membership.ridearrivo.com is its own dedicated subdomain too, but
 * renders MembershipApp, a custom multi-step page (identify, pick a
 * plan, confirm), not the generic PublicIntakeForm, because it needs
 * a plan picker with expandable benefits, not a flat field list. Its
 * final "confirm" step still submits through the same intake platform
 * (slug "membership-signup"), so it shows up in Support's queue exactly
 * like contact-us/charter-booking submissions do.
 *
 * move.ridearrivo.com is its own dedicated subdomain too, but renders
 * MoveApp, a custom multi-step page (intro, move details with a live
 * price estimate, contact and confirm), not the generic PublicIntakeForm,
 * because it needs the estimate calculator alongside the fields. Its
 * final "confirm" step still submits through the same intake platform
 * (slug "move-booking"), so it shows up in Support's queue exactly like
 * contact-us/charter-booking submissions do.
 */
function normalizedPath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '' ? '/' : path
}

export default function FormsApp() {
  const path = normalizedPath()

  if (
    window.location.hostname.toLowerCase() === 'bookings.ridearrivo.com'
  ) {
    return <PublicIntakeForm slug="charter-booking" />
  }

  if (
    window.location.hostname.toLowerCase() === 'membership.ridearrivo.com'
  ) {
    return <MembershipApp />
  }

  if (
    window.location.hostname.toLowerCase() === 'move.ridearrivo.com'
  ) {
    return <MoveApp />
  }

  if (path === '/contact-us') {
    return <PublicIntakeForm slug="contact-us" />
  }

  if (path === '/charter-booking') {
    return <PublicIntakeForm slug="charter-booking" />
  }

  if (path === '/' || path === '/investor') {
    return <InvestorInterestForm />
  }

  return (
    <main className="formsPage">
      <section className="formsShell formsSuccessShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">NOT FOUND</span>
        </header>

        <div className="formsSuccess">
          <span className="formsEyebrow">PAGE NOT FOUND</span>
          <h1>There's no form at this address.</h1>
          <p>Check the link, or head back to the RideArrivo investor & stakeholder form.</p>
          <a href="/">
            <button type="button">Go to forms.ridearrivo.com</button>
          </a>
        </div>
      </section>
    </main>
  )
}
