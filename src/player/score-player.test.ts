import { expect, test } from "bun:test"
import { PlayerMode, synth, type model } from "@coderline/alphatab"
import { beatSpanOf, selectionLabel } from "../charts/score-bars.ts"
import { createMixer, setMute, setSolo, setTrackVolume } from "../charts/score-mixer.ts"
import type { Notation } from "../charts/score-notation.ts"
import {
  createScorePlayer,
  type DisplaySettings,
  type PlayerMasterBar,
  type PlayerApi,
  type PlayerStaff,
  type PlayerTrack,
} from "./score-player.ts"

class Emitter<T = void> {
  handlers = new Set<(value: T) => void>()
  on(handler: (value: T) => void) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  emit(value: T) {
    for (const handler of this.handlers) handler(value)
  }
}

/** `scoreLoaded` with a score that has no tracks unless a test gives some. */
class ScoreLoadedEmitter extends Emitter<{
  tempo: number
  tracks: ReadonlyArray<PlayerTrack>
  masterBars: ReadonlyArray<PlayerMasterBar>
}> {
  override emit(value: {
    tempo: number
    tracks?: ReadonlyArray<PlayerTrack>
    masterBars?: ReadonlyArray<PlayerMasterBar>
  }) {
    super.emit({ tracks: [], masterBars: [], ...value })
  }
}

/** A track whose file volume is `volume` / 16. */
const track = (index: number, name: string, volume = 16, program = 25, isPercussion = false): PlayerTrack => ({
  index,
  name,
  shortName: name.slice(0, 3),
  isPercussion,
  playbackInfo: { volume, program },
  staves: [
    {
      isStringed: program >= 24 && program <= 39,
      isPercussion,
      showStandardNotation: true,
      showTablature: false,
    },
  ],
})

const SCORE_TRACKS = [track(0, "Guitar", 16), track(1, "  "), track(2, "Bass", 8)]

/** A drawn track of bars of beats, shaped like alphaTab's model: each number is a beat's start tick. */
function beatTrack(bars: ReadonlyArray<ReadonlyArray<number>>): model.Track {
  const staff = { bars: [] as unknown[] }
  bars.forEach((ticks, index) => {
    const bar = { masterBar: { index }, voices: [] as unknown[] }
    const voice = { bar, beats: [] as unknown[] }
    voice.beats = ticks.map((tick, beat) => ({ absolutePlaybackStart: tick, index: beat, voice }))
    bar.voices.push(voice)
    staff.bars.push(bar)
  })
  return { staves: [staff] } as unknown as model.Track
}

/** Three bars: one of three beats, one of two, one of one. A beat's tick is its number times 100. */
const BARS = [[0, 100, 200], [300, 400], [500]]

function fakeApi() {
  const calls: string[] = []
  // What the selection and cursor calls did, apart from `calls`, which older tests compare whole.
  const moves: string[] = []
  const drawn = beatTrack(BARS)
  const beats = drawn.staves[0]!.bars.flatMap((bar) => bar.voices[0]!.beats)
  const beatOf = (tick: number) => beats.find((beat) => beat.absolutePlaybackStart === tick)!
  let range: { startTick: number; endTick: number } | null = null
  let marked: { startBeat: model.Beat; endBeat: model.Beat } | null = null
  const api = {
    tracks: [drawn] as ReadonlyArray<model.Track>,
    tickPosition: 0,
    scrollToCursor: () => void moves.push("scroll"),
    // False for the synthesizer, whose range event comes back from its worker later; a test emits that event itself.
    syncEvents: true,
    playbackRangeChanged: new Emitter<{ playbackRange: unknown }>(),
    playbackRangeHighlightChanged: new Emitter<{ startBeat?: model.Beat; endBeat?: model.Beat }>(),
    get playbackRange() {
      return range
    },
    // alphaTab fires the range event on every set, a null one included.
    set playbackRange(value: { startTick: number; endTick: number } | null) {
      range = value
      moves.push(`range:${value ? `${value.startTick}-${value.endTick}` : "none"}`)
      if (api.syncEvents) api.playbackRangeChanged.emit({ playbackRange: value })
    },
    highlightPlaybackRange(startBeat: model.Beat, endBeat: model.Beat) {
      marked = { startBeat, endBeat }
      moves.push(`highlight:${startBeat.absolutePlaybackStart}-${endBeat.absolutePlaybackStart}`)
      // alphaTab reports the beats in playback order, and nothing for a one-beat highlight.
      const [first, last] = [startBeat, endBeat].sort((a, b) => a.absolutePlaybackStart - b.absolutePlaybackStart)
      api.playbackRangeHighlightChanged.emit(startBeat === endBeat ? {} : { startBeat: first!, endBeat: last! })
    },
    // Like alphaTab, the highlight's beats become the ticks of the range, in order.
    applyPlaybackRangeFromHighlight() {
      if (!marked) return
      const ordered = [marked.startBeat, marked.endBeat].sort(
        (a, b) => a.absolutePlaybackStart - b.absolutePlaybackStart,
      )
      const [first, last] = ordered
      const after = beats[beats.indexOf(beatOf(last!.absolutePlaybackStart)) + 1]
      range = { startTick: first!.absolutePlaybackStart, endTick: after?.absolutePlaybackStart ?? 600 }
      moves.push(`apply:${range.startTick}-${range.endTick}`)
      api.playbackRangeChanged.emit({ playbackRange: range })
    },
    clearPlaybackRangeHighlight() {
      marked = null
      moves.push("clear-highlight")
      api.playbackRangeHighlightChanged.emit({})
    },
    // What a replaced player does: it starts at the top with no range, and says nothing.
    forget() {
      range = null
      api.timePosition = 0
    },
    scoreLoaded: new ScoreLoadedEmitter(),
    renderStarted: new Emitter<boolean>(),
    postRenderFinished: new Emitter(),
    renderer: { partialRenderFinished: new Emitter<{ renderResult: unknown }>() },
    playerReady: new Emitter(),
    playerStateChanged: new Emitter<{ state: number }>(),
    playerPositionChanged: new Emitter<{ currentTime: number; endTime: number }>(),
    playerFinished: new Emitter(),
    error: new Emitter<{ message: string }>(),
    resize: new Emitter<{ newWidth: number; settings: { display: DisplaySettings } | null }>(),
    container: { width: 1024 },
    accepts: true,
    timePosition: 0,
    metronomeVolume: 0,
    countInVolume: 0,
    playbackSpeed: 1,
    isLooping: false,
    masterVolume: 1,
    changeTrackVolume: (tracks: PlayerTrack[], volume: number) =>
      void calls.push(`volume:${tracks.map((track) => track.index).join()}:${volume}`),
    changeTrackSolo: (tracks: PlayerTrack[], solo: boolean) =>
      void calls.push(`solo:${tracks.map((track) => track.index).join()}:${solo}`),
    changeTrackMute: (tracks: PlayerTrack[], mute: boolean) =>
      void calls.push(`mute:${tracks.map((track) => track.index).join()}:${mute}`),
    renderTracks: (tracks: PlayerTrack[]) => void calls.push(`render:${tracks.map((track) => track.index).join()}`),
    settings: {
      display: { scale: 1, stretchForce: 1, startBar: 1, barCount: -1 },
      player: { playerMode: PlayerMode.EnabledExternalMedia },
    },
    updateSettings: () => void calls.push("updateSettings"),
    render: () => void calls.push("render"),
    load(data: unknown) {
      calls.push(`load:${typeof data === "string" ? data : "bytes"}`)
      return api.accepts
    },
    tex: (tex: string) => void calls.push(`tex:${tex}`),
    renderScore: (score: model.Score) => void calls.push(`score:${(score as unknown as { name: string }).name}`),
    play: () => (calls.push("play"), true),
    pause: () => void calls.push("pause"),
    playPause: () => void calls.push("playPause"),
    stop: () => void calls.push("stop"),
  }
  return { api: api satisfies PlayerApi, calls, moves, beats }
}

const handlerCount = (api: ReturnType<typeof fakeApi>["api"]) =>
  [
    api.scoreLoaded,
    api.renderStarted,
    api.postRenderFinished,
    api.renderer.partialRenderFinished,
    api.playerReady,
    api.playerStateChanged,
    api.playerPositionChanged,
    api.playerFinished,
    api.resize,
    api.error,
    api.playbackRangeChanged,
    api.playbackRangeHighlightChanged,
  ].reduce((sum, emitter) => sum + emitter.handlers.size, 0)

test("a loaded score makes the state ready, and the draw events bracket rendered", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  expect(player.getState().status).toBe("loading")
  api.scoreLoaded.emit({ tempo: 120 })
  api.renderStarted.emit(false)
  expect(player.getState()).toMatchObject({ status: "ready", rendered: false })
  api.postRenderFinished.emit()
  expect(player.getState().rendered).toBe(true)
  api.renderStarted.emit(true)
  expect(player.getState().rendered).toBe(false)
})

test("drawn turns true at the first drawn part, survives a redraw, and a load resets it", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120 })
  api.renderStarted.emit(false)
  // With lazy loading the layout reports empty parts and finishes the render before any part is drawn.
  api.renderer.partialRenderFinished.emit({ renderResult: null })
  api.postRenderFinished.emit()
  expect(player.getState()).toMatchObject({ rendered: true, drawn: false })
  api.renderer.partialRenderFinished.emit({ renderResult: "<svg></svg>" })
  expect(player.getState().drawn).toBe(true)
  api.renderStarted.emit(true)
  expect(player.getState()).toMatchObject({ rendered: false, drawn: true })
  player.load({ url: "/next.gp" })
  expect(player.getState().drawn).toBe(false)
})

test("load passes a URL or bytes to alphaTab and tex to its tex call", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  player.load({ url: "/a.gp" })
  player.load({ bytes: new Uint8Array(1) })
  player.load({ tex: "3.3.4" })
  expect(calls).toEqual(["load:/a.gp", "load:bytes", "tex:3.3.4"])
})

test("load fails when alphaTab cannot read the data, and an error event fails the state", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  api.accepts = false
  player.load({ bytes: new Uint8Array(1) })
  expect(player.getState()).toMatchObject({ status: "error", error: "The score viewer cannot read this file." })
  api.accepts = true
  player.load({ url: "/b.gp" })
  expect(player.getState()).toMatchObject({ status: "loading", error: null })
  api.error.emit({ message: "bad header" })
  expect(player.getState()).toMatchObject({ status: "error", error: "bad header" })
})

test("playing follows the player state event", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  api.playerStateChanged.emit({ state: synth.PlayerState.Playing })
  expect(player.getState().playing).toBe(true)
  api.playerStateChanged.emit({ state: synth.PlayerState.Paused })
  expect(player.getState().playing).toBe(false)
})

test("position follows the position event; stop rewinds; seek clamps to the end", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  api.playerPositionChanged.emit({ currentTime: 1500, endTime: 60000 })
  expect(player.getState()).toMatchObject({ positionMs: 1500, endMs: 60000 })
  player.seek(99999)
  expect(api.timePosition).toBe(60000)
  player.seek(-5)
  expect(api.timePosition).toBe(0)
  player.seek(2500)
  expect(player.getState().positionMs).toBe(2500)
  player.stop()
  expect(calls).toEqual(["stop"])
  expect(player.getState().positionMs).toBe(0)
})

test("metronome and count-in set their volumes, and the initial choice is applied at once", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { metronome: true })
  expect(api.metronomeVolume).toBe(1)
  expect(api.countInVolume).toBe(0)
  player.setMetronome(false)
  player.setCountIn(true)
  expect(api.metronomeVolume).toBe(0)
  expect(api.countInVolume).toBe(1)
  expect(player.getState()).toMatchObject({ metronome: false, countIn: true })
})

test("speed is clamped, applied to the API at once, and set from the options", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { speed: 0.5 })
  expect(api.playbackSpeed).toBe(0.5)
  player.setSpeed(10)
  expect(api.playbackSpeed).toBe(3)
  expect(player.getState().speed).toBe(3)
  player.setSpeed(0)
  expect(api.playbackSpeed).toBe(0.25)
  expect(player.getState().speed).toBe(0.25)
})

test("tempo is the score's tempo at the current speed, and null when the score names none", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  expect(player.getState().tempo).toBeNull()
  api.scoreLoaded.emit({ tempo: 120 })
  expect(player.getState().tempo).toBe(120)
  player.setSpeed(0.75)
  expect(player.getState().tempo).toBe(90)
  player.setSpeed(1.33)
  expect(player.getState().tempo).toBe(159.6)
  api.scoreLoaded.emit({ tempo: 0 })
  expect(player.getState().tempo).toBeNull()
})

test("a finished loop counts, and the speed steps up after loopCount passes", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { loop: true, loopCount: 2, stepMode: "percent", stepValue: 10 })
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1.1)
  expect(api.playbackSpeed).toBe(1.1)
})

test("a bpm step adds beats to the score's tempo, not to the displayed tempo", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { loop: true, stepMode: "bpm", stepValue: 12 })
  api.scoreLoaded.emit({ tempo: 120 })
  player.setSpeed(0.5)
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(0.6)
})

test("no step happens when the trainer loop is off", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { loopCount: 1, stepValue: 10 })
  api.playerFinished.emit()
  api.playerFinished.emit()
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
  expect(api.playbackSpeed).toBe(1)
})

test("stop restarts the loop count, so a pass before it does not count", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { loop: true, loopCount: 2, stepValue: 10 })
  api.playerFinished.emit()
  player.stop()
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
})

test("seek and a speed the player chose also restart the loop count", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { loop: true, loopCount: 2, stepValue: 10 })
  api.playerFinished.emit()
  player.seek(0)
  api.playerFinished.emit()
  player.setSpeed(1)
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
})

test("setLoop drives the API's loop flag; trainer settings update the state, and an equal one is silent", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  player.setLoop(true)
  expect(api.isLooping).toBe(true)
  player.setLoopCount(3)
  player.setStepMode("bpm")
  player.setStepValue(4)
  expect(player.getState().trainer).toEqual({ loop: true, loopCount: 3, stepMode: "bpm", stepValue: 4 })
  let heard = 0
  player.subscribe(() => heard++)
  player.setLoopCount(3)
  expect(heard).toBe(0)
  player.setLoop(false)
  expect(api.isLooping).toBe(false)
})

test("subscribers hear a change once, an equal update is silent, and dispose removes every handler", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  let heard = 0
  const unsubscribe = player.subscribe(() => heard++)
  player.play()
  expect(heard).toBe(1)
  api.playerReady.emit()
  api.playerReady.emit()
  expect(heard).toBe(2)
  const before = player.getState()
  api.postRenderFinished.emit()
  expect(player.getState()).not.toBe(before)
  expect(heard).toBe(3)
  unsubscribe()
  api.postRenderFinished.emit()
  api.renderStarted.emit(false)
  player.dispose()
  expect(handlerCount(api)).toBe(0)
})

test("the tracks are listed with the label function, or by name with a fallback", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  expect(player.getState()).toMatchObject({ tracks: [], track: null })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().tracks).toEqual([
    { index: 0, label: "Guitar" },
    { index: 1, label: "Track 2" },
    { index: 2, label: "Bass" },
  ])
  const second = fakeApi()
  const again = createScorePlayer(second.api, { trackLabel: (item) => item.shortName })
  second.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(again.getState().tracks.map((option) => option.label)).toEqual(["Gui", "  ", "Bas"])
})

test("the first track is track 0 without a second draw", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().track).toBe(0)
  expect(calls).toEqual([])
})

test("defaultTrack is drawn on load, and an index outside the score falls back to 0", () => {
  const picked = fakeApi()
  const player = createScorePlayer(picked.api, { defaultTrack: 2 })
  picked.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().track).toBe(2)
  expect(picked.calls).toEqual(["render:2"])
  const outside = fakeApi()
  const fallback = createScorePlayer(outside.api, { defaultTrack: 9 })
  outside.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(fallback.getState().track).toBe(0)
  expect(outside.calls).toEqual([])
})

test("setTrack draws only that track, ignores an index outside the score, and restarts the loop count", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api, { loop: true, loopCount: 2, stepValue: 10 })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  api.playerFinished.emit()
  player.setTrack(1)
  expect(calls).toEqual(["render:1"])
  expect(player.getState().track).toBe(1)
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
  player.setTrack(7)
  expect(calls).toEqual(["render:1"])
  expect(player.getState().track).toBe(1)
})

test("a score without a saved mixer starts each track at its file's volume", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().mixer).toEqual(createMixer([1, 1, 0.5]))
})

test("a saved mixer is fitted on load, master is applied at once, and tracks wait for playerReady", () => {
  const { api, calls } = fakeApi()
  const saved = setMute(
    setSolo(setTrackVolume({ ...createMixer([1, 1, 1, 1]), master: 0.4 }, 0, 0.3), 1, true),
    2,
    true,
  )
  const heard: unknown[] = []
  const player = createScorePlayer(api, { mixer: saved, onMixerChange: (mixer) => heard.push(mixer) })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().mixer).toEqual({ ...saved, tracks: saved.tracks.slice(0, 3) })
  expect(api.masterVolume).toBe(0.4)
  expect(calls).toEqual([])
  player.play()
  calls.length = 0
  api.playerReady.emit()
  expect(calls).toEqual([
    "volume:0:0.3",
    "solo:0:false",
    "mute:0:false",
    "volume:1:1",
    "solo:1:true",
    "mute:1:false",
    "volume:2:1",
    "solo:2:false",
    "mute:2:true",
    "play",
  ])
  expect(heard).toEqual([])
})

test("each mixer action reaches the API and the callback", () => {
  const { api, calls } = fakeApi()
  const heard: unknown[] = []
  const player = createScorePlayer(api, { onMixerChange: (mixer) => heard.push(mixer) })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  player.setMasterVolume(0.5)
  expect(api.masterVolume).toBe(0.5)
  player.setTrackVolume(2, 0.25)
  player.setSolo(1, true)
  player.setMute(0, true)
  expect(calls).toEqual(["volume:2:0.25", "solo:1:true", "mute:0:true"])
  const mixer = player.getState().mixer
  expect(mixer.master).toBe(0.5)
  expect(mixer.tracks).toEqual([
    { volume: 1, solo: false, mute: true },
    { volume: 1, solo: true, mute: false },
    { volume: 0.25, solo: false, mute: false },
  ])
  expect(heard).toHaveLength(4)
  expect(heard.at(-1)).toBe(mixer)
})

test("the mixer callback is read when it is called, so a later callback replaces an earlier one", () => {
  const { api } = fakeApi()
  const calls: string[] = []
  let current = () => calls.push("first")
  const player = createScorePlayer(api, {
    get onMixerChange() {
      return current
    },
  })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  player.setMasterVolume(0.5)
  current = () => calls.push("second")
  player.setMasterVolume(0.6)
  expect(calls).toEqual(["first", "second"])
})

test("a volume above the range is clamped before it reaches the API", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  player.setTrackVolume(0, 4)
  player.setMasterVolume(-1)
  expect(calls).toEqual(["volume:0:1"])
  expect(api.masterVolume).toBe(0)
})

const display = (api: ReturnType<typeof fakeApi>["api"]) => api.settings.display

test("a zoom is clamped, drawn at once, and reported to the callback", () => {
  const { api, calls } = fakeApi()
  const zooms: number[] = []
  const player = createScorePlayer(api, { onZoomChange: (zoom) => zooms.push(zoom) })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  player.setZoom(9)
  expect(player.getState().zoom).toBe(2.5)
  expect(display(api).scale).toBe(2.5)
  player.setZoom(0.1)
  expect(display(api).scale).toBe(0.5)
  expect(zooms).toEqual([2.5, 0.5])
  expect(calls).toEqual(["updateSettings", "render", "updateSettings", "render"])
})

test("a resize event writes the band's scale and stretch into its settings and leaves the draw to alphaTab", () => {
  const { api, calls } = fakeApi()
  createScorePlayer(api, { zoom: 2 })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  calls.length = 0
  const settings = { display: { scale: 1, stretchForce: 1, startBar: 1, barCount: -1 } }
  api.resize.emit({ newWidth: 300, settings })
  expect(settings.display).toMatchObject({ scale: 0.78 * 2, stretchForce: 0.82 })
  api.resize.emit({ newWidth: 1200, settings })
  expect(settings.display).toMatchObject({ scale: 2, stretchForce: 1 })
  api.resize.emit({ newWidth: 300, settings: null })
  expect(calls).toEqual([])
})

test("a zoom after a resize uses the stored width", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  api.resize.emit({ newWidth: 400, settings: { display: { scale: 1, stretchForce: 1, startBar: 1, barCount: -1 } } })
  player.setZoom(2)
  expect(display(api)).toMatchObject({ scale: 0.84 * 2, stretchForce: 0.88 })
  expect(calls).toEqual(["updateSettings", "render"])
})

test("the first display comes from the container's width, and draws nothing", () => {
  const { api, calls } = fakeApi()
  api.container.width = 500
  createScorePlayer(api, { zoom: 1.5 })
  expect(display(api)).toMatchObject({ scale: 0.9 * 1.5, stretchForce: 0.94 })
  expect(calls).toEqual(["updateSettings"])
})

test("a saved zoom is used on load and is not reported", () => {
  const { api, calls } = fakeApi()
  const zooms: number[] = []
  const player = createScorePlayer(api, { zoom: 1.5, onZoomChange: (zoom) => zooms.push(zoom) })
  expect(player.getState().zoom).toBe(1.5)
  expect(display(api).scale).toBe(1.5)
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(zooms).toEqual([])
  expect(calls).toEqual(["updateSettings"])
})

const shown = (staff: PlayerStaff) => ({ standard: staff.showStandardNotation, tab: staff.showTablature })

test("a guitar shows standard plus tab, a piano and a drum track show standard only", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api, { defaultTrack: 0 })
  const tracks = [
    track(0, "Guitar", 16, 25),
    track(1, "Piano", 16, 0),
    track(2, "Drums", 16, 0, true),
    track(3, "Bass", 16, 33),
  ]
  api.scoreLoaded.emit({ tempo: 120, tracks })
  expect(player.getState().notation).toEqual({ standard: true, tab: true })
  expect(tracks.map((t) => shown(t.staves[0]!))).toEqual([
    { standard: true, tab: true },
    { standard: true, tab: false },
    { standard: true, tab: false },
    { standard: true, tab: true },
  ])
})

test("the drawn track sets the notation: a piano or a drum track draws standard only", () => {
  for (const [wanted, tracks] of [
    [1, [track(0, "Guitar", 16, 25), track(1, "Piano", 16, 0)]],
    [1, [track(0, "Guitar", 16, 25), track(1, "Drums", 16, 30, true)]],
  ] as const) {
    const { api } = fakeApi()
    const player = createScorePlayer(api, { defaultTrack: wanted })
    api.scoreLoaded.emit({ tempo: 120, tracks })
    expect(player.getState().notation).toEqual({ standard: true, tab: false })
  }
})

test("a saved notation wins on load, and a load does not call the callback", () => {
  const { api } = fakeApi()
  const saved: Notation[] = []
  const player = createScorePlayer(api, {
    notation: { standard: false, tab: true },
    onNotationChange: (n) => saved.push(n),
  })
  const tracks = [track(0, "Guitar", 16, 25)]
  api.scoreLoaded.emit({ tempo: 120, tracks })
  expect(player.getState().notation).toEqual({ standard: false, tab: true })
  expect(shown(tracks[0]!.staves[0]!)).toEqual({ standard: false, tab: true })
  expect(saved).toEqual([])
})

test("setTrack resets the notation to the new track's default", () => {
  const { api } = fakeApi()
  const player = createScorePlayer(api)
  api.scoreLoaded.emit({ tempo: 120, tracks: [track(0, "Guitar", 16, 25), track(1, "Piano", 16, 0)] })
  player.setNotation("standard")
  expect(player.getState().notation).toEqual({ standard: false, tab: true })
  player.setTrack(1)
  expect(player.getState().notation).toEqual({ standard: true, tab: false })
  player.setTrack(0)
  expect(player.getState().notation).toEqual({ standard: true, tab: true })
})

test("a toggle applies to every staff, draws, and reports; a staff without strings keeps standard", () => {
  const { api, calls } = fakeApi()
  const saved: Notation[] = []
  const player = createScorePlayer(api, { onNotationChange: (n) => saved.push(n) })
  const tracks = [track(0, "Guitar", 16, 25), track(1, "Piano", 16, 0)]
  api.scoreLoaded.emit({ tempo: 120, tracks })
  player.setNotation("standard")
  expect(player.getState().notation).toEqual({ standard: false, tab: true })
  expect(tracks.map((t) => shown(t.staves[0]!))).toEqual([
    { standard: false, tab: true },
    { standard: true, tab: false },
  ])
  expect(calls).toEqual(["render"])
  expect(saved).toEqual([{ standard: false, tab: true }])
  player.setNotation("tab")
  expect(player.getState().notation).toEqual({ standard: true, tab: false })
})

/** A ready player on the three-bar score with the cursor on `tick`, and the call logs cleared. */
function keyed(tick = 0, options = {}) {
  const fake = fakeApi()
  const player = createScorePlayer(fake.api, options)
  fake.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  player.play()
  fake.api.playerReady.emit()
  fake.api.tickPosition = tick
  fake.moves.length = 0
  fake.calls.length = 0
  return { ...fake, player }
}

type Mods = { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean }
const press = (key: string, mods: Mods = {}) => ({
  key,
  code: key === " " ? "Space" : key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
  repeat: mods.repeat ?? false,
})
const SPACE = press(" ")

test("each navigation key moves the cursor to its beat and says it handled the key", () => {
  const cases: Array<[from: number, key: ReturnType<typeof press>, to: number]> = [
    [100, press("ArrowRight"), 200],
    [200, press("ArrowRight"), 300],
    [100, press("ArrowLeft"), 0],
    [300, press("ArrowLeft"), 200],
    [200, press("Home"), 0],
    [400, press("Home"), 300],
    [0, press("End"), 200],
    [300, press("End"), 400],
    [400, press("Home", { ctrl: true }), 0],
    [100, press("End", { ctrl: true }), 500],
    [100, press("ArrowRight", { ctrl: true }), 300],
    [400, press("ArrowRight", { ctrl: true }), 500],
    [400, press("ArrowLeft", { ctrl: true }), 0],
    [500, press("ArrowLeft", { ctrl: true }), 300],
    [150, press("ArrowRight"), 200],
  ]
  for (const [from, key, to] of cases) {
    const { api, player } = keyed(from)
    expect(player.handleKey(key)).toBe(true)
    expect([key.key, key.ctrlKey, api.tickPosition]).toEqual([key.key, key.ctrlKey, to])
  }
})

test("a move at the edge of the score stays put; a bar jump with no bar to go to is not handled", () => {
  const first = keyed(0)
  expect(first.player.handleKey(press("ArrowLeft"))).toBe(true)
  expect(first.api.tickPosition).toBe(0)
  expect(first.player.handleKey(press("ArrowLeft", { ctrl: true }))).toBe(false)
  const last = keyed(500)
  expect(last.player.handleKey(press("ArrowRight"))).toBe(true)
  expect(last.api.tickPosition).toBe(500)
  expect(last.player.handleKey(press("ArrowRight", { ctrl: true }))).toBe(false)
  expect(last.player.handleKey(press("a"))).toBe(false)
})

test("a move scrolls to the cursor and shows its time while paused", () => {
  const { api, moves, player } = keyed(0)
  api.timePosition = 1234
  player.handleKey(press("ArrowRight"))
  expect(moves).toContain("scroll")
  expect(player.getState().positionMs).toBe(1234)
})

test("Shift with a move extends the selection from the beat it began on", () => {
  const { api, moves, player } = keyed(100)
  expect(player.handleKey(press("ArrowRight", { shift: true }))).toBe(true)
  expect(moves).toEqual(["highlight:100-200", "apply:100-300", "scroll"])
  expect(api.tickPosition).toBe(200)
  expect(player.getState().selection).toEqual({
    first: { bar: 0, beat: 1, beatCount: 3 },
    last: { bar: 0, beat: 2, beatCount: 3 },
  })
  expect(selectionLabel(player.getState().selection!)).toBe("Bar 1, beats 2–3")
  moves.length = 0
  player.handleKey(press("ArrowRight", { shift: true }))
  expect(moves[0]).toBe("highlight:100-300")
  expect(api.tickPosition).toBe(300)
  player.handleKey(press("ArrowLeft", { shift: true }))
  player.handleKey(press("ArrowLeft", { shift: true }))
  player.handleKey(press("ArrowLeft", { shift: true }))
  expect(moves.at(-3)).toBe("highlight:100-0")
  expect(player.getState().selection!.first).toEqual({ bar: 0, beat: 0, beatCount: 3 })
})

test("a selection of whole bars reads as bars", () => {
  const { player } = keyed(0)
  player.handleKey(press("End", { shift: true }))
  expect(selectionLabel(player.getState().selection!)).toBe("Bar 1")
  player.handleKey(press("ArrowRight", { shift: true, ctrl: true }))
  player.handleKey(press("End", { shift: true, ctrl: true }))
  expect(selectionLabel(player.getState().selection!)).toBe("Bars 1–3")
})

test("a plain move drops the selection and its anchor", () => {
  const { api, moves, player } = keyed(100)
  player.handleKey(press("ArrowRight", { shift: true }))
  moves.length = 0
  player.handleKey(press("ArrowRight"))
  expect(moves).toEqual(["range:none", "clear-highlight", "scroll"])
  expect(player.getState().selection).toBeNull()
  expect(api.playbackRange).toBeNull()
  moves.length = 0
  player.handleKey(press("ArrowRight", { shift: true }))
  expect(moves[0]).toBe("highlight:300-400")
})

test("a drag by the mouse in between starts the next Shift move from the cursor", () => {
  const { api, moves, player } = keyed(0)
  player.handleKey(press("ArrowRight", { shift: true }))
  api.tickPosition = 400
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 300, endTick: 500 } })
  moves.length = 0
  player.handleKey(press("ArrowRight", { shift: true }))
  expect(moves[0]).toBe("highlight:400-500")
})

test("Space plays or pauses, loads the sound on the first press, and a repeat is ignored but still handled", () => {
  const { calls, player } = keyed(0)
  expect(player.handleKey(SPACE)).toBe(true)
  expect(calls).toEqual(["playPause"])
  expect(player.handleKey(press(" ", { repeat: true }))).toBe(true)
  expect(calls).toEqual(["playPause"])
  const early = fakeApi()
  const waiting = createScorePlayer(early.api)
  early.api.scoreLoaded.emit({ tempo: 120 })
  expect(waiting.handleKey(SPACE)).toBe(true)
  expect(early.calls).toEqual(["updateSettings"])
  expect(waiting.getState().sound).toBe("loading")
})

test("Ctrl+Space plays from the first beat and drops the selection", () => {
  const { api, calls, player } = keyed(300)
  player.handleKey(press("ArrowRight", { shift: true }))
  calls.length = 0
  expect(player.handleKey(press(" ", { ctrl: true }))).toBe(true)
  expect(calls).toEqual(["stop", "play"])
  expect(api.tickPosition).toBe(0)
  expect(api.playbackRange).toBeNull()
  expect(player.getState().selection).toBeNull()
  expect(player.handleKey(press(" ", { ctrl: true, repeat: true }))).toBe(true)
  expect(calls).toEqual(["stop", "play"])
})

test("Alt and Meta keys are not handled", () => {
  const { api, calls, player } = keyed(100)
  for (const mods of [{ alt: true }, { meta: true }]) {
    expect(player.handleKey(press("ArrowRight", mods))).toBe(false)
    expect(player.handleKey(press(" ", mods))).toBe(false)
  }
  expect(api.tickPosition).toBe(100)
  expect(calls).toEqual([])
})

test("no key does anything until a score is loaded, or after a failed load", () => {
  const { api, calls, moves, player } = (() => {
    const fake = fakeApi()
    return { ...fake, player: createScorePlayer(fake.api) }
  })()
  for (const key of [SPACE, press("ArrowRight"), press("Home", { ctrl: true }), press(" ", { ctrl: true })]) {
    expect(player.handleKey(key)).toBe(false)
  }
  api.error.emit({ message: "bad" })
  expect(player.handleKey(SPACE)).toBe(false)
  expect([calls, moves]).toEqual([[], []])
})

test("a range event with its highlight sets the selection, and one without clears it", () => {
  const { api, beats, player } = keyed(0)
  api.playbackRangeHighlightChanged.emit({ startBeat: beats[3]!, endBeat: beats[4]! })
  expect(player.getState().selection).toBeNull()
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 300, endTick: 500 } })
  expect(selectionLabel(player.getState().selection!)).toBe("Bar 2")
  api.playbackRangeChanged.emit({ playbackRange: null })
  expect(player.getState().selection).toBeNull()
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 300, endTick: 500 } })
  api.playbackRangeHighlightChanged.emit({})
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 0, endTick: 600 } })
  expect(player.getState().selection).toBeNull()
})

test("clearSelection drops the range, the highlight and the selection", () => {
  const { api, moves, player } = keyed(0)
  player.handleKey(press("ArrowRight", { shift: true }))
  moves.length = 0
  player.clearSelection()
  expect(moves).toEqual(["range:none", "clear-highlight"])
  expect(api.playbackRange).toBeNull()
  expect(player.getState().selection).toBeNull()
})

test("a selection change restarts the trainer's loop count", () => {
  const { api, beats, player } = keyed(0, { loop: true, loopCount: 2, stepMode: "percent", stepValue: 10 })
  api.playerFinished.emit()
  api.playbackRangeHighlightChanged.emit({ startBeat: beats[0]!, endBeat: beats[2]! })
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 0, endTick: 300 } })
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1)
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1.1)
})

test("a new score or track drops the selection", () => {
  const { api, player } = keyed(0)
  player.handleKey(press("End", { shift: true }))
  expect(player.getState().selection).not.toBeNull()
  player.setTrack(1)
  expect(player.getState().selection).toBeNull()
  expect(api.playbackRange).toBeNull()
  player.handleKey(press("End", { shift: true }))
  player.load({ url: "/next.gp" })
  expect(player.getState().selection).toBeNull()
  player.handleKey(press("End", { shift: true }))
  api.scoreLoaded.emit({ tempo: 120 })
  expect(player.getState().selection).toBeNull()
})

/** A player with a fake clock, and the seconds it reported. */
function practiced() {
  const { api } = fakeApi()
  const reported: number[] = []
  let time = 1000
  const player = createScorePlayer(api, { onPracticeTime: (seconds) => reported.push(seconds) }, () => time)
  const at = (ms: number) => void (time = 1000 + ms)
  const position = () => api.playerPositionChanged.emit({ currentTime: 0, endTime: 60000 })
  const playing = () => api.playerStateChanged.emit({ state: synth.PlayerState.Playing })
  const paused = () => api.playerStateChanged.emit({ state: synth.PlayerState.Paused })
  return { api, player, reported, at, position, playing, paused }
}

test("12 seconds of play report 10 at the threshold, then the rest at the stop", () => {
  const { reported, at, position, playing, paused } = practiced()
  playing()
  at(4000)
  position()
  expect(reported).toEqual([])
  at(10000)
  position()
  expect(reported).toEqual([10])
  at(12000)
  paused()
  expect(reported).toEqual([10, 2])
})

test("pause stops the clock, and position events while stopped count nothing", () => {
  const { reported, at, position, playing, paused } = practiced()
  playing()
  at(3000)
  paused()
  expect(reported).toEqual([3])
  at(20000)
  position()
  at(40000)
  position()
  expect(reported).toEqual([3])
  playing()
  at(41000)
  paused()
  expect(reported).toEqual([3, 1])
})

test("a stop under one second reports nothing, and the remainder carries to the next stop", () => {
  const { reported, at, playing, paused } = practiced()
  playing()
  at(600)
  paused()
  expect(reported).toEqual([])
  playing()
  at(1100)
  paused()
  expect(reported).toEqual([1])
})

test("load and dispose report what is pending", () => {
  const { player, reported, at, playing } = practiced()
  playing()
  at(2000)
  player.load({ url: "/next.gp" })
  expect(reported).toEqual([2])
  playing()
  at(5000)
  player.dispose()
  expect(reported).toEqual([2, 3])
})

test("a track change and a finished pass report, and a looping player keeps counting", () => {
  const { api, player, reported, at, playing } = practiced()
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  playing()
  at(2000)
  player.setTrack(1)
  expect(reported).toEqual([2])
  at(5000)
  api.playerFinished.emit()
  expect(reported).toEqual([2, 3])
  at(7000)
  api.playerFinished.emit()
  expect(reported).toEqual([2, 3, 2])
})

test("the practice callback is read when it is called, and none set means no report", () => {
  const { api } = fakeApi()
  const calls: string[] = []
  let current: ((seconds: number) => void) | undefined
  let time = 0
  createScorePlayer(
    api,
    {
      get onPracticeTime() {
        return current
      },
    },
    () => time,
  )
  api.playerStateChanged.emit({ state: synth.PlayerState.Playing })
  time = 2000
  api.playerStateChanged.emit({ state: synth.PlayerState.Paused })
  current = (seconds) => calls.push(`late:${seconds}`)
  api.playerStateChanged.emit({ state: synth.PlayerState.Playing })
  time = 5000
  api.playerStateChanged.emit({ state: synth.PlayerState.Paused })
  expect(calls).toEqual(["late:3"])
})

/** The first play switches the API to the synthesizer; the sound font arrives with `playerReady`. */
const loadedSound = () => {
  const fake = fakeApi()
  const player = createScorePlayer(fake.api)
  fake.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  return { ...fake, player }
}

test("a loaded score makes no mode change, and a playerReady from external-media mode is ignored", () => {
  const { api, calls, player } = loadedSound()
  expect(api.settings.player.playerMode).toBe(PlayerMode.EnabledExternalMedia)
  api.playerReady.emit()
  expect(player.getState().sound).toBe("off")
  expect(calls).toEqual([])
})

test("the first play switches the mode once and plays at playerReady; sound goes off, loading, ready", () => {
  const { api, calls, player } = loadedSound()
  const seen = [player.getState().sound]
  player.subscribe(() => seen.push(player.getState().sound))
  player.play()
  expect(api.settings.player.playerMode).toBe(PlayerMode.EnabledSynthesizer)
  expect(calls).toEqual(["updateSettings"])
  player.play()
  expect(calls).toEqual(["updateSettings"])
  api.playerReady.emit()
  expect(player.getState().sound).toBe("ready")
  expect(seen).toEqual(["off", "loading", "ready"])
  expect(calls.at(-1)).toBe("play")
  expect(calls.filter((call) => call === "play")).toHaveLength(1)
  player.play()
  player.playPause()
  expect(calls.slice(-2)).toEqual(["play", "playPause"])
  expect(calls.filter((call) => call === "updateSettings")).toHaveLength(1)
})

test("playPause on a silent player loads the sound and plays; a second press while loading cancels the play", () => {
  const { api, calls, player } = loadedSound()
  player.playPause()
  expect(player.getState().sound).toBe("loading")
  player.playPause()
  api.playerReady.emit()
  expect(player.getState().sound).toBe("ready")
  expect(calls).not.toContain("play")
  player.playPause()
  expect(calls.at(-1)).toBe("playPause")
  const again = loadedSound()
  again.player.playPause()
  again.api.playerReady.emit()
  expect(again.calls.at(-1)).toBe("play")
})

test("stop, seek and the settings actions before the first play load no sound", () => {
  const { api, calls, player } = loadedSound()
  player.seek(500)
  player.stop()
  player.pause()
  player.setSpeed(0.5)
  player.setLoop(true)
  player.setMetronome(true)
  player.setCountIn(true)
  player.setMasterVolume(0.5)
  player.setTrackVolume(0, 0.5)
  player.setSolo(1, true)
  expect(api.settings.player.playerMode).toBe(PlayerMode.EnabledExternalMedia)
  expect(player.getState().sound).toBe("off")
  expect(calls).not.toContain("updateSettings")
})

test("stop, pause and load while the sound loads drop the pending play but the sound still arrives", () => {
  for (const drop of [
    (player: ReturnType<typeof loadedSound>["player"]) => player.stop(),
    (player: ReturnType<typeof loadedSound>["player"]) => player.pause(),
    (player: ReturnType<typeof loadedSound>["player"]) => player.load({ url: "/b.gp" }),
  ]) {
    const { api, calls, player } = loadedSound()
    player.play()
    drop(player)
    api.playerReady.emit()
    expect(player.getState().sound).toBe("ready")
    expect(calls).not.toContain("play")
  }
})

test("dispose while the sound loads drops the pending play", () => {
  const { api, calls, player } = loadedSound()
  player.play()
  player.dispose()
  api.playerReady.emit()
  expect(calls).not.toContain("play")
})

test("mixer settings reach the new player before the pending play starts", () => {
  const { api, calls, player } = loadedSound()
  player.setSolo(1, true)
  player.play()
  calls.length = 0
  api.playerReady.emit()
  expect(calls).toEqual([
    "volume:0:1",
    "solo:0:false",
    "mute:0:false",
    "volume:1:1",
    "solo:1:true",
    "mute:1:false",
    "volume:2:0.5",
    "solo:2:false",
    "mute:2:false",
    "play",
  ])
})

test("the position and the selection set before the first play survive the new player", () => {
  const { api, player } = loadedSound()
  api.timePosition = 1200
  api.playbackRange = { startTick: 100, endTick: 300 }
  api.tickPosition = 200
  player.play()
  api.forget()
  api.playerReady.emit()
  expect(api.playbackRange).toEqual({ startTick: 100, endTick: 300 })
  expect(api.timePosition).toBe(1200)
})

test("a position outside the range is not restored: the player stays at the range's start", () => {
  const { api, player } = loadedSound()
  api.playbackRange = { startTick: 100, endTick: 300 }
  api.timePosition = 5
  api.tickPosition = 2
  player.play()
  api.forget()
  api.timePosition = 0
  api.playerReady.emit()
  expect(api.timePosition).toBe(0)
})

test("a seek while the sound loads is not overwritten when the sound arrives", () => {
  const { api, player } = loadedSound()
  api.timePosition = 1200
  player.play()
  player.seek(300)
  api.playerReady.emit()
  expect(api.timePosition).toBe(300)
})

/** A master bar as alphaTab's model reports it, with a tempo marking when `tempo` is given. */
const masterBar = (start: number, duration: number, tempo?: number): PlayerMasterBar => ({
  start,
  calculateDuration: () => duration,
  tempoAutomations: tempo === undefined ? [] : [{ value: tempo }],
})

/** The bars of `BARS` with their ticks: 120 bpm from the first bar, 90 bpm from the third. */
const MASTER_BARS = [masterBar(0, 300, 120), masterBar(300, 200), masterBar(500, 100, 90)]

/** A player on the three-bar score with its bars known, and the call logs cleared. */
function barred(options: Parameters<typeof createScorePlayer>[1] = {}) {
  const fake = fakeApi()
  const player = createScorePlayer(fake.api, options)
  fake.api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS, masterBars: MASTER_BARS })
  fake.moves.length = 0
  fake.calls.length = 0
  return { ...fake, player }
}

test("a parsed score is drawn by renderScore", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  player.load({ score: { name: "parsed" } as unknown as model.Score })
  expect(calls).toEqual(["score:parsed"])
  expect(player.getState().status).toBe("loading")
})

test("bars are written into the display before the first draw, and the score plays only them", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api, { bars: { first: 1, last: 2 } })
  expect(api.settings.display).toMatchObject({ startBar: 2, barCount: 2 })
  expect(calls).toEqual(["updateSettings"])
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS, masterBars: MASTER_BARS })
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 600 })
  expect(player.getState().selection).toBeNull()
})

test("without bars the whole score is drawn and no range is set", () => {
  const { api, calls } = fakeApi()
  createScorePlayer(api)
  expect(api.settings.display).toMatchObject({ startBar: 1, barCount: -1 })
  expect(calls).toEqual([])
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS, masterBars: MASTER_BARS })
  expect(api.playbackRange).toBeNull()
})

test("setBars draws the new bars again without a load, and the range, tempo and selection follow", () => {
  const { api, calls, player } = barred({ bars: { first: 0, last: 0 } })
  player.selectBars({ first: 0, last: 0 })
  expect(player.getState().selection).not.toBeNull()
  calls.length = 0
  player.setBars({ first: 1, last: 2 })
  expect(api.settings.display).toMatchObject({ startBar: 2, barCount: 2 })
  expect(calls).toEqual(["updateSettings", "render:0"])
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 600 })
  expect(player.getState()).toMatchObject({ selection: null, tempo: 120 })
  calls.length = 0
  player.setBars({ first: 1, last: 2 })
  player.setBars(null)
  expect(api.settings.display).toMatchObject({ startBar: 1, barCount: -1 })
  expect(api.playbackRange).toBeNull()
})

test("setBars before a score loads changes the settings only", () => {
  const { api, calls } = fakeApi()
  const player = createScorePlayer(api)
  player.setBars({ first: 2, last: 2 })
  expect(api.settings.display).toMatchObject({ startBar: 3, barCount: 1 })
  expect(calls).toEqual(["updateSettings"])
})

test("selectBars selects whole bars as a drag would, makes them the range, and keeps quiet", () => {
  const changes: unknown[] = []
  const { api, beats, moves, player } = barred({ onSelectionChange: (selection) => changes.push(selection) })
  player.selectBars({ first: 0, last: 1 })
  expect(api.playbackRange).toEqual({ startTick: 0, endTick: 500 })
  expect(selectionLabel(player.getState().selection!)).toBe("Bars 1–2")
  expect(player.getState().selection).toEqual(beatSpanOf(beats[0]!, beats[4]!))
  expect(moves).toEqual(["range:0-500"])
  // The same bars again change nothing, and a drag inside them is not replaced by whole bars.
  moves.length = 0
  player.selectBars({ first: 0, last: 1 })
  expect(moves).toEqual([])
  player.selectBars(null)
  expect(player.getState().selection).toBeNull()
  expect(api.playbackRange).toBeNull()
  player.selectBars({ first: 2, last: 2 })
  expect(selectionLabel(player.getState().selection!)).toBe("Bar 3")
  expect(changes).toEqual([])
})

test("selectBars ignores bars the score does not have, bars outside the drawn bars, and a score not loaded", () => {
  const fake = fakeApi()
  const early = createScorePlayer(fake.api)
  early.selectBars({ first: 0, last: 0 })
  expect(fake.moves).toEqual([])
  const { api, player } = barred({ bars: { first: 1, last: 1 } })
  player.selectBars({ first: 0, last: 1 })
  player.selectBars({ first: 1, last: 5 })
  player.selectBars({ first: 2, last: 1 })
  expect(player.getState().selection).toBeNull()
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 500 })
})

test("clearing a selection returns to the drawn bars, not the whole score", () => {
  const { api, player } = barred({ bars: { first: 1, last: 2 } })
  player.selectBars({ first: 2, last: 2 })
  expect(api.playbackRange).toEqual({ startTick: 500, endTick: 600 })
  player.clearSelection()
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 600 })
  expect(player.getState().selection).toBeNull()
})

test("a drag or a key reports the selection to onSelectionChange; the player's own changes do not", () => {
  const changes: Array<string | null> = []
  const { api, beats, player } = barred({
    onSelectionChange: (selection) => changes.push(selection && selectionLabel(selection)),
  })
  api.tickPosition = 0
  api.playbackRangeHighlightChanged.emit({ startBeat: beats[3]!, endBeat: beats[4]! })
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 300, endTick: 450 } })
  expect(changes).toEqual(["Bar 2"])
  // The same event twice is one change.
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 300, endTick: 450 } })
  expect(changes).toEqual(["Bar 2"])
  player.selectBars({ first: 0, last: 0 })
  player.clearSelection()
  player.setBars({ first: 0, last: 1 })
  player.setTrack(1)
  player.load({ url: "/next.gp" })
  api.scoreLoaded.emit({ tempo: 120, masterBars: MASTER_BARS })
  expect(changes).toEqual(["Bar 2"])
  // A drag that ends the selection is reported as null.
  api.playbackRangeHighlightChanged.emit({ startBeat: beats[0]!, endBeat: beats[1]! })
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 0, endTick: 150 } })
  api.playbackRangeChanged.emit({ playbackRange: null })
  expect(changes).toEqual(["Bar 2", "Bar 1, beats 1–2", null])
  api.tickPosition = 0
  player.handleKey(press("ArrowRight", { shift: true }))
  expect(changes.at(-1)).toBe("Bar 1, beats 1–2")
})

test("a range change that comes back late from the synthesizer is the player's own, whatever the selection", () => {
  const changes: unknown[] = []
  const { api, player } = barred({ onSelectionChange: (selection) => changes.push(selection) })
  api.syncEvents = false
  player.selectBars({ first: 0, last: 1 })
  const selection = player.getState().selection
  api.playbackRangeChanged.emit({ playbackRange: { startTick: 0, endTick: 500 } })
  expect(player.getState().selection).toBe(selection)
  player.clearSelection()
  api.playbackRangeChanged.emit({ playbackRange: null })
  expect(player.getState().selection).toBeNull()
  expect(changes).toEqual([])
})

test("the tempo is the one where the passage starts: the selection, else the drawn bars, else the score", () => {
  const { player } = barred()
  expect(player.getState().tempo).toBe(120)
  player.selectBars({ first: 2, last: 2 })
  expect(player.getState().tempo).toBe(90)
  player.setSpeed(0.5)
  expect(player.getState().tempo).toBe(45)
  player.selectBars({ first: 1, last: 2 })
  expect(player.getState().tempo).toBe(60)
  player.clearSelection()
  expect(player.getState().tempo).toBe(60)
  const drawn = barred({ bars: { first: 2, last: 2 } })
  expect(drawn.player.getState().tempo).toBe(90)
  drawn.player.setBars({ first: 1, last: 1 })
  expect(drawn.player.getState().tempo).toBe(120)
})

test("a bpm step adds to the tempo where the passage starts", () => {
  const { api, player } = barred({ bars: { first: 2, last: 2 }, loop: true, stepMode: "bpm", stepValue: 9 })
  api.playerFinished.emit()
  expect(player.getState().speed).toBe(1.1)
})

test("the keys reach the drawn bars only", () => {
  const { api, player } = barred({ bars: { first: 1, last: 1 } })
  player.play()
  api.playerReady.emit()
  api.tickPosition = 300
  player.handleKey(press("ArrowRight"))
  expect(api.tickPosition).toBe(400)
  player.handleKey(press("ArrowRight"))
  expect(api.tickPosition).toBe(400)
  player.handleKey(press("End", { ctrl: true }))
  expect(api.tickPosition).toBe(400)
  player.handleKey(press("Home", { ctrl: true }))
  expect(api.tickPosition).toBe(300)
  api.tickPosition = 400
  player.handleKey(press(" ", { ctrl: true }))
  expect(api.tickPosition).toBe(300)
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 500 })
})

test("the first play keeps the drawn bars, and a selection made while the sound loads", () => {
  const { api, player } = barred({ bars: { first: 1, last: 2 } })
  player.play()
  api.forget()
  api.playerReady.emit()
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 600 })
  expect(player.getState().sound).toBe("ready")

  const later = barred({ bars: { first: 1, last: 2 } })
  later.player.play()
  later.player.selectBars({ first: 2, last: 2 })
  later.api.forget()
  later.api.playerReady.emit()
  expect(later.api.playbackRange).toEqual({ startTick: 500, endTick: 600 })
  expect(selectionLabel(later.player.getState().selection!)).toBe("Bar 3")
})

test("the range is set again when alphaTab has loaded the MIDI, which drops a range set before it", () => {
  const { api, moves, player } = barred({ bars: { first: 1, last: 2 } })
  api.forget()
  moves.length = 0
  api.playerReady.emit()
  expect(api.playbackRange).toEqual({ startTick: 300, endTick: 600 })
  // The drawn bars are no selection, so no highlight stays on them.
  expect(moves).toEqual(["range:300-600", "clear-highlight"])
  expect(player.getState().sound).toBe("off")

  player.selectBars({ first: 2, last: 2 })
  const selection = player.getState().selection
  api.forget()
  moves.length = 0
  api.playerReady.emit()
  expect(api.playbackRange).toEqual({ startTick: 500, endTick: 600 })
  expect(moves).toEqual(["range:500-600"])
  expect(player.getState().selection).toBe(selection)
})

test("a mixer given in the options solos its track at the first playerReady, as an app plays one track only", () => {
  const { api, calls } = fakeApi()
  const mixer = setSolo(createMixer([1, 1, 0.5]), 1, true)
  const player = createScorePlayer(api, { mixer })
  api.scoreLoaded.emit({ tempo: 120, tracks: SCORE_TRACKS })
  expect(player.getState().mixer.tracks.map((mix) => mix.solo)).toEqual([false, true, false])
  player.play()
  calls.length = 0
  api.playerReady.emit()
  expect(calls.filter((call) => call.startsWith("solo:"))).toEqual(["solo:0:false", "solo:1:true", "solo:2:false"])
})
