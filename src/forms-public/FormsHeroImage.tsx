import handshakeLarge from './assets/handshake-1024.webp'
import handshakeSmall from './assets/handshake-640.webp'
import handshakeMobile from './assets/handshake-mobile-560.webp'
import easybookLarge from './assets/easybook-1024.webp'
import easybookSmall from './assets/easybook-640.webp'
import easybookMobile from './assets/easybook-mobile-560.webp'
import membershipLarge from './assets/membership-1024.webp'
import membershipSmall from './assets/membership-640.webp'
import membershipMobile from './assets/membership-mobile-560.webp'
import airLarge from './assets/air-1024.webp'
import airSmall from './assets/air-640.webp'
import airMobile from './assets/air-mobile-560.webp'
import boatLarge from './assets/boat-1024.webp'
import boatSmall from './assets/boat-640.webp'
import boatMobile from './assets/boat-mobile-560.webp'
import moveLarge from './assets/move-1024.webp'
import moveSmall from './assets/move-640.webp'
import moveMobile from './assets/move-mobile-560.webp'

/*
 * Banner photo for the public form pages. Every picture ships as three
 * pre-compressed WebP files, each under 50 KB (the originals were about
 * 2 MB):
 *   - phones (up to 640px wide) get a 3:2 crop centred on the subject,
 *   - everything else picks the 640w or 1024w version by screen width.
 * width and height are set so the browser reserves the space before the
 * image arrives and the page does not jump. The photo is the first visual
 * on the page, so it loads eagerly instead of lazily.
 *
 * Add a page by adding a key here plus its three files in ./assets.
 */
type Picture = {
  large: string
  small: string
  mobile: string
  alt: string
  /** Natural size of the large file, used for the width/height attributes. */
  width: number
  height: number
  mobileWidth: number
  mobileHeight: number
}

const PICTURES = {
  handshake: {
    large: handshakeLarge, small: handshakeSmall, mobile: handshakeMobile,
    alt: 'Two professionals shaking hands in an office',
    width: 1024, height: 546, mobileWidth: 560, mobileHeight: 420,
  },
  easybook: {
    large: easybookLarge, small: easybookSmall, mobile: easybookMobile,
    alt: 'A woman booking a ride on her phone while a chauffeur waits by an open car door',
    width: 1024, height: 409, mobileWidth: 560, mobileHeight: 373,
  },
  membership: {
    large: membershipLarge, small: membershipSmall, mobile: membershipMobile,
    alt: 'A man in a hotel lounge holding a membership card and a phone',
    width: 1024, height: 409, mobileWidth: 560, mobileHeight: 373,
  },
  air: {
    large: airLarge, small: airSmall, mobile: airMobile,
    alt: 'A passenger being welcomed aboard a private jet at sunset',
    width: 1024, height: 409, mobileWidth: 560, mobileHeight: 373,
  },
  boat: {
    large: boatLarge, small: boatSmall, mobile: boatMobile,
    alt: 'A passenger being helped aboard a boat at a marina at sunset',
    width: 1024, height: 409, mobileWidth: 560, mobileHeight: 373,
  },
  move: {
    large: moveLarge, small: moveSmall, mobile: moveMobile,
    alt: 'A removal crew carrying wrapped furniture and boxes from a truck while a couple watches at sunset',
    width: 1024, height: 409, mobileWidth: 560, mobileHeight: 373,
  },
} satisfies Record<string, Picture>

export type FormsHeroVariant = keyof typeof PICTURES

export default function FormsHeroImage({ variant = 'handshake' }: { variant?: FormsHeroVariant }) {
  const picture = PICTURES[variant]
  return (
    <div className="formsHeroImage">
      <picture>
        <source
          media="(max-width: 640px)"
          srcSet={picture.mobile}
          width={picture.mobileWidth}
          height={picture.mobileHeight}
          type="image/webp"
        />
        <source
          srcSet={`${picture.small} 640w, ${picture.large} 1024w`}
          sizes="(max-width: 1100px) 92vw, 1024px"
          type="image/webp"
        />
        <img
          src={picture.large}
          width={picture.width}
          height={picture.height}
          alt={picture.alt}
          decoding="async"
          loading="eager"
        />
      </picture>
    </div>
  )
}
