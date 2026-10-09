/*
 * Shared wordmark used by every public forms page. Two plain images, one
 * for each theme; the stylesheet shows the one that matches
 * html[data-theme]. (This used to be a canvas that stripped the navy
 * background off a single dark-mode image, which could not work on a light
 * page.)
 */
export function RideArrivoExactLogo() {
  return (
    <a
      href="https://www.ridearrivo.com"
      className="formsLogoLink"
      aria-label="RideArrivo home"
    >
      <img
        className="formsLogoCanvas logoOnLight"
        src="/ridearrivo-wordmark-on-light.png"
        width={1829}
        height={309}
        alt="RideArrivo"
      />
      <img
        className="formsLogoCanvas logoOnDark"
        src="/ridearrivo-wordmark-on-dark.png"
        width={1829}
        height={309}
        alt=""
        aria-hidden="true"
      />
    </a>
  )
}
