import { useState } from 'react'
import { FONT_STYLES, readFontStyle, saveFontStyle, type FontStyleId } from '../lib/fontStyle'

export default function FontStyleCard() {
  const [current, setCurrent] = useState<FontStyleId>(() => readFontStyle())
  return (
    <section className="fontStyleCard" aria-label="Font style">
      <h3>Font style</h3>
      <p>Pick how text looks on this device. Logos and code blocks keep their own fonts.</p>
      <div className="fontStyleGrid" role="radiogroup" aria-label="Font style">
        {FONT_STYLES.map(item => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={current === item.id}
            className={`fontStyleOption${current === item.id ? ' on' : ''}`}
            style={item.stack ? { fontFamily: item.stack } : undefined}
            onClick={() => { setCurrent(item.id); saveFontStyle(item.id) }}
          >
            <strong>{item.label}</strong>
            <span>The quick brown fox</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
