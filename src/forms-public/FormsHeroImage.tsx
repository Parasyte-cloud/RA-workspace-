import desktopLarge from './assets/handshake-1024.webp'
import desktopSmall from './assets/handshake-640.webp'
import mobile from './assets/handshake-mobile-560.webp'

/*
 * Banner photo for the public forms. Three pre-compressed WebP files, each
 * under 50 KB (the original was about 2 MB):
 *   - phones (up to 640px wide) get a 4:3 crop centred on the handshake,
 *   - everything else picks the 640w or 1024w version by screen width.
 * width and height are set so the browser reserves the space before the
 * image arrives and the page does not jump. The photo is the first thing
 * on screen, so it loads eagerly instead of lazily.
 */
export default function FormsHeroImage() {
  return (
    <div className="formsHeroImage">
      <picture>
        <source media="(max-width: 640px)" srcSet={mobile} width={560} height={420} type="image/webp" />
        <source
          srcSet={`${desktopSmall} 640w, ${desktopLarge} 1024w`}
          sizes="(max-width: 1100px) 92vw, 1024px"
          type="image/webp"
        />
        <img
          src={desktopLarge}
          width={1024}
          height={546}
          alt="Two professionals shaking hands in an office"
          decoding="async"
          loading="eager"
        />
      </picture>
    </div>
  )
}
