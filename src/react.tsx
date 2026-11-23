import { useMemo, type ReactNode } from "react"
import { preload } from "react-dom"
import { ALPHATAB_BASE } from "./index.ts"
import { staticScoreCss, staticScoreHtml, type StaticScore } from "./static.ts"

export interface StaticScoreFrameProps {
  /** The score drawn ahead of time, on the server or at build time. */
  readonly score: StaticScore
  /**
   * True once the player inside has drawn its first part: set it from
   * `useScorePlayer`'s `state.drawn`, or, for a bare `AlphaTabApi`, from the
   * first `api.renderer.partialRenderFinished` that carries a `renderResult`.
   * `rendered` and `renderFinished` are too early, because with lazy loading
   * they come when the layout is done and before any part is drawn, so the
   * frame would show an empty player.
   */
  readonly playerReady: boolean
  /** Where the page serves alphaTab's fonts. Defaults to where the kit's Vite plugin serves them. */
  readonly fontDirectory?: string
  /** The element alphaTab draws into. */
  readonly children: ReactNode
}

/**
 * Shows a static score in place of a player until the player has drawn.
 *
 * The static score holds the page layout, so a server-rendered page shows the
 * music before any script runs. The player's element sits over it, at full
 * width but invisible, so alphaTab can measure it and draw. When
 * `playerReady` turns true the player takes the static score's place. Print
 * always shows the static score, which keeps whole systems on each page.
 */
export function StaticScoreFrame({
  score,
  playerReady,
  fontDirectory = `${ALPHATAB_BASE}font/`,
  children,
}: StaticScoreFrameProps) {
  preload(`${fontDirectory}Bravura.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" })
  const html = useMemo(() => staticScoreHtml(score), [score])
  return (
    <div className="at-frame" data-player-ready={playerReady ? "" : undefined}>
      <style href={`gigbag.js/static-score${fontDirectory}`} precedence="gigbag.js">
        {`${staticScoreCss(fontDirectory)}\n${FRAME_CSS}`}
      </style>
      <div className="at-frame-static" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="at-frame-player">{children}</div>
    </div>
  )
}

// visibility, not display: alphaTab skips drawing into an element with no width.
const FRAME_CSS = `.at-frame{position:relative}
.at-frame:not([data-player-ready])>.at-frame-player{position:absolute;inset:0;visibility:hidden}
.at-frame[data-player-ready]>.at-frame-static{display:none}
@media print{.at-frame>.at-frame-static{display:block!important}.at-frame>.at-frame-player{display:none!important}}`
