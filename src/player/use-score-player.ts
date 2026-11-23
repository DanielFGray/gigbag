import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { AlphaTabApi, PlayerMode, Settings } from "@coderline/alphatab"
import { alphaTabAssetUrls } from "../index.ts"
import { createMixer } from "../charts/score-mixer.ts"
import {
  createScorePlayer,
  DEFAULT_TRAINER,
  type ScorePlayer,
  type ScorePlayerActions,
  type ScorePlayerOptions,
  type ScorePlayerState,
  type ScoreSource,
  STANDARD_ONLY,
} from "./score-player.ts"
import { listenForKeys } from "./keyboard.ts"
import { inkFrom, observeTheme } from "./ink.ts"

export interface UseScorePlayerOptions extends ScorePlayerOptions {
  readonly source: ScoreSource
  /**
   * Edits alphaTab's settings before the API is built: an app adds its padding, scroll element and
   * hidden elements here. The kit has already set the engine, the player, the asset URLs and the ink (the
   * host's text color). Only the function from the render that builds the API runs.
   *
   * This is the place for `settings.player.scrollElement` when the app scrolls the score inside its own box:
   * alphaTab resolves that setting on its first scroll and keeps the element, so a later change has no effect.
   * An app whose scroll box changes rebuilds the player (a new `key` on the component that calls the hook).
   * A theme change re-applies the ink only; colors set here are not kept over it.
   */
  readonly configure?: (settings: Settings) => void
}

export interface UseScorePlayer {
  /** Attach to the element alphaTab draws into. The API exists after the first commit. */
  readonly host: RefObject<HTMLDivElement | null>
  /**
   * Attach to the element that holds the score and the app's controls, so a shortcut works with focus on any of
   * them. Read once, when the API is built. Unattached, the keys come from the host's parent.
   */
  readonly keyRoot: RefObject<HTMLDivElement | null>
  readonly state: ScorePlayerState
  readonly actions: ScorePlayerActions
}

/**
 * Builds an `AlphaTabApi` on `host`, loads `source` and returns the controller's state and actions.
 * The API is destroyed on unmount and rebuilt when the source changes (compared by the bytes or score object,
 * URL or tex text, so pass the same `Uint8Array` or `Score` across renders). The other options are read when the
 * API is built, except `bars`, which redraws the score without rebuilding, and the callbacks, which are read when
 * they are called. Browser only: it reads `location`.
 *
 * Keys go to the player from `keyRoot`. The host's parent is the default, and it only reaches controls that
 * share that parent: an app whose toolbar sits outside it attaches `keyRoot` to the element holding both.
 */
export function useScorePlayer(options: UseScorePlayerOptions): UseScorePlayer {
  const host = useRef<HTMLDivElement>(null)
  const keyRoot = useRef<HTMLDivElement>(null)
  const [player, setPlayer] = useState<ScorePlayer | null>(null)
  const latest = useRef(options)
  latest.current = options
  const { source } = options
  const [kind, identity] = sourceIdentity(source)
  // The bounds, not the object: an equal span from a new object does not redraw.
  const first = options.bars?.first ?? null
  const last = options.bars?.last ?? null

  useEffect(() => {
    const element = host.current
    if (!element) return
    const { configure, source: current, ...initial } = latest.current
    const settings = new Settings()
    const urls = alphaTabAssetUrls()
    settings.core.engine = "svg"
    settings.core.scriptFile = urls.scriptFile
    settings.core.fontDirectory = urls.fontDirectory
    // No audio yet: the cursor and selection work, and the first play switches to the synthesizer.
    settings.player.playerMode = PlayerMode.EnabledExternalMedia
    settings.player.enableCursor = true
    settings.player.soundFont = urls.soundFont
    inkFrom(settings, getComputedStyle(element).color)
    configure?.(settings)
    const api = new AlphaTabApi(element, settings)
    // Getters, so a callback from a later render is the one called: this controller is built once.
    const live: ScorePlayerOptions = {
      ...initial,
      get trackLabel() {
        return latest.current.trackLabel
      },
      get onMixerChange() {
        return latest.current.onMixerChange
      },
      get onZoomChange() {
        return latest.current.onZoomChange
      },
      get onNotationChange() {
        return latest.current.onNotationChange
      },
      get onPracticeTime() {
        return latest.current.onPracticeTime
      },
      get onSelectionChange() {
        return latest.current.onSelectionChange
      },
    }
    const created = createScorePlayer(api, live)
    setPlayer(created)
    created.load(current)
    // The ink follows the text color around the host: a theme toggle on the root element redraws the score in it.
    const stopTheme = observeTheme(() => {
      inkFrom(api.settings, getComputedStyle(element).color)
      api.updateSettings()
      if (created.getState().status === "ready") api.render()
    })
    // The host takes focus so the keys reach it. The listener sits on the key root, or on the host's parent
    // when the app names none.
    if (!element.hasAttribute("tabindex")) element.tabIndex = 0
    const stopKeys = listenForKeys(keyRoot.current ?? element.parentElement ?? element, (event) =>
      created.handleKey(event),
    )
    return () => {
      stopKeys()
      stopTheme()
      created.dispose()
      api.destroy()
      setPlayer(null)
    }
  }, [kind, identity])

  // A change of the drawn bars redraws the score; it does not rebuild the player. The first run finds the bars
  // the controller was built with, and does nothing.
  useEffect(() => {
    player?.setBars(first === null || last === null ? null : { first, last })
  }, [player, first, last])

  const state = useSyncExternalStore(
    player?.subscribe ?? subscribeNothing,
    player?.getState ?? (() => INITIAL_STATE),
    () => INITIAL_STATE,
  )
  return { host, keyRoot, state, actions: player ?? INERT_ACTIONS }
}

function sourceIdentity(source: ScoreSource): readonly [string, unknown] {
  if ("bytes" in source) return ["bytes", source.bytes]
  if ("url" in source) return ["url", source.url]
  if ("score" in source) return ["score", source.score]
  return ["tex", source.tex]
}

const INITIAL_STATE: ScorePlayerState = {
  status: "loading",
  error: null,
  rendered: false,
  drawn: false,
  sound: "off",
  playing: false,
  positionMs: 0,
  endMs: 0,
  metronome: false,
  countIn: false,
  speed: 1,
  tempo: null,
  trainer: DEFAULT_TRAINER,
  tracks: [],
  track: null,
  mixer: createMixer([]),
  zoom: 1,
  notation: STANDARD_ONLY,
  selection: null,
}

const subscribeNothing = () => () => {}

const noop = () => {}

/** Stands in until the API exists, so a control can call an action on the first render. */
const INERT_ACTIONS: ScorePlayerActions = {
  play: noop,
  pause: noop,
  playPause: noop,
  stop: noop,
  seek: noop,
  setMetronome: noop,
  setCountIn: noop,
  setSpeed: noop,
  setLoop: noop,
  setLoopCount: noop,
  setStepMode: noop,
  setStepValue: noop,
  setTrack: noop,
  setMasterVolume: noop,
  setTrackVolume: noop,
  setSolo: noop,
  setMute: noop,
  setZoom: noop,
  setNotation: noop,
  clearSelection: noop,
  selectBars: noop,
  handleKey: () => false,
}
