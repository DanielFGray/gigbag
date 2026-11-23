import { PlayerMode, type model } from "@coderline/alphatab";
import { type BarSpan, type BeatSpan } from "../charts/score-bars.ts";
import { type Mixer } from "../charts/score-mixer.ts";
import { type Notation } from "../charts/score-notation.ts";
import { type TrackOption } from "../charts/score-tracks.ts";
import { type StepMode } from "../charts/speed-trainer.ts";
import type { KeyPress } from "./keyboard.ts";
/**
 * Where a score comes from: file bytes, a URL alphaTab downloads, alphaTex source, or a score the app has parsed.
 * The app keeps a parsed score it also reads itself, such as to list its tracks or to draw it in more than one view.
 * The controller sets the staves' notation on it, so a score shared between views shows the same notation in each.
 */
export type ScoreSource = {
    readonly bytes: Uint8Array;
} | {
    readonly url: string;
} | {
    readonly tex: string;
} | {
    readonly score: model.Score;
};
/** The speed trainer's settings. Each finished loop of the passage counts; after `loopCount` counts the speed steps up. */
export interface TrainerState {
    readonly loop: boolean;
    readonly loopCount: number;
    readonly stepMode: StepMode;
    readonly stepValue: number;
}
/** The trainer's defaults when the app gives no choice: one loop per step, and a 5 % step. */
export declare const DEFAULT_TRAINER: TrainerState;
/** The notation before a score loads: standard only, since no track is known to have strings. */
export declare const STANDARD_ONLY: Notation;
/** What the controller shows: all of it derives from alphaTab's events and the actions below. */
export interface ScorePlayerState {
    /** `loading` until alphaTab has parsed the score; `error` after a load or render failure. */
    readonly status: "loading" | "ready" | "error";
    readonly error: string | null;
    /** True once the score is drawn; false again while a redraw runs. Beat positions are valid only when true. */
    readonly rendered: boolean;
    /**
     * True once the host holds the first drawn part of this score; false from each `load` until then, and a redraw
     * leaves it true. With lazy loading `rendered` turns true when the layout is done, before any part is drawn, so
     * this is the field that says the player shows music (for example `StaticScoreFrame`'s `playerReady`).
     */
    readonly drawn: boolean;
    /**
     * The synthesizer and its sound font (about 1 MB) load on the first play, not with the score. `off` until then,
     * `loading` while they download, `ready` once they can play. The cursor, seek and selection work in every state.
     */
    readonly sound: "off" | "loading" | "ready";
    readonly playing: boolean;
    readonly positionMs: number;
    readonly endMs: number;
    readonly metronome: boolean;
    readonly countIn: boolean;
    /** The playback speed: 1 is the score's own tempo. Always inside the range `clampSpeed` allows. */
    readonly speed: number;
    /**
     * The tempo where the passage starts, at `speed`, rounded to a tenth: the passage is the selection, else the
     * drawn bars, else the whole score. The tempo is the nearest marking at or before that bar. Null when the score
     * names none.
     */
    readonly tempo: number | null;
    readonly trainer: TrainerState;
    /** The score's tracks; empty until a score loads. */
    readonly tracks: ReadonlyArray<TrackOption>;
    /** The index of the track drawn; null before a score loads. */
    readonly track: number | null;
    /** Master volume and each track's volume, solo and mute. Holds the saved settings until a score loads. */
    readonly mixer: Mixer;
    /** The user's zoom, 0.5 to 2.5. The drawn scale is this on top of a base that depends on the host's width. */
    readonly zoom: number;
    /** What every track's staves show. It resets to the drawn track's default when a score loads or `setTrack` runs. */
    readonly notation: Notation;
    /**
     * The beats the user selected: by a drag, by keys, or by `selectBars`. Null when nothing is selected, and
     * the playback range is then the drawn bars (`bars`), else the whole score. The app words it with `selectionLabel`.
     */
    readonly selection: BeatSpan | null;
}
/** The actions of a controller. Each is a bound function, so it can be passed on as is. */
export interface ScorePlayerActions {
    play: () => void;
    pause: () => void;
    playPause: () => void;
    /** Stops and rewinds to the start. */
    stop: () => void;
    /** Moves the playback position, clamped to the score's length once that is known. */
    seek: (ms: number) => void;
    setMetronome: (on: boolean) => void;
    setCountIn: (on: boolean) => void;
    /** Clamped to the supported speed range. A speed the player chose restarts the trainer's loop count. */
    setSpeed: (speed: number) => void;
    setLoop: (on: boolean) => void;
    setLoopCount: (count: number) => void;
    setStepMode: (mode: StepMode) => void;
    setStepValue: (value: number) => void;
    /** Draws only this track and restarts the trainer's loop count. An index outside the score is ignored. */
    setTrack: (index: number) => void;
    /** Volumes are clamped to 0..1. Each mixer action calls `onMixerChange`; a track index outside the score throws a RangeError. */
    setMasterVolume: (volume: number) => void;
    setTrackVolume: (track: number, volume: number) => void;
    setSolo: (track: number, solo: boolean) => void;
    setMute: (track: number, mute: boolean) => void;
    /** Clamped to the zoom range. Redraws when the scale changes, and calls `onZoomChange`. */
    setZoom: (zoom: number) => void;
    /** Flips one notation for every track and redraws. At least one stays on. Calls `onNotationChange`. */
    setNotation: (which: keyof Notation) => void;
    /** Drops the selection: the drawn bars (else the whole score) play again. */
    clearSelection: () => void;
    /**
     * Selects whole bars, counted from 0 with both ends inclusive, as a drag would, and makes them the playback range.
     * Null clears the selection. Nothing happens before a score is loaded, for bars outside the drawn bars, or when the
     * selection already touches exactly these bars (a drag inside one bar is not replaced by the whole bar).
     * It does not call `onSelectionChange`: the app that sets a selection already knows it.
     */
    selectBars: (span: BarSpan | null) => void;
    /**
     * Handles one key press and returns true when it was a score shortcut, so the caller can `preventDefault`.
     * Space plays or pauses (Ctrl: from the start); the arrows move one beat (Ctrl: one bar); Home and End go to
     * the edge of the bar (Ctrl: of the score); Shift with a move extends the selection from the beat it began on.
     * Alt, Meta and every other key are not handled, and nothing is handled before a score is loaded.
     */
    handleKey: (key: KeyPress) => boolean;
}
/** A score player: a state snapshot, a subscription to its changes, and the actions. */
export interface ScorePlayer extends ScorePlayerActions {
    /** The current snapshot. It is the same object until the state changes, as `useSyncExternalStore` needs. */
    getState: () => ScorePlayerState;
    /** Calls `listener` after each state change. Returns the function that removes it. */
    subscribe: (listener: () => void) => () => void;
    /** Starts loading a score. Call it once, after the player is created, so no event is missed. */
    load: (source: ScoreSource) => void;
    /**
     * Changes which bars are drawn (null: all of them) and draws again; the score is not loaded again. The playback
     * range and the tempo follow, and the selection is dropped. `useScorePlayer` calls this when its `bars` option
     * changes.
     */
    setBars: (span: BarSpan | null) => void;
    /** Removes every handler the player put on the API. It does not destroy the API: its creator does. */
    dispose: () => void;
}
export interface ScorePlayerOptions {
    readonly metronome?: boolean;
    readonly countIn?: boolean;
    readonly speed?: number;
    readonly loop?: boolean;
    readonly loopCount?: number;
    readonly stepMode?: StepMode;
    readonly stepValue?: number;
    /** Builds a track's label; the default is the trimmed name, or "Track n" when it is blank. */
    readonly trackLabel?: (track: PlayerTrack, index: number) => string;
    /** The track drawn first. An index outside the score falls back to 0. */
    readonly defaultTrack?: number;
    /**
     * The bars drawn, counted from 0 with both ends inclusive; null or missing draws the whole score. Playback covers
     * them when nothing is selected, and the tempo shown is the one where they start.
     */
    readonly bars?: BarSpan | null;
    /**
     * Called with the new selection when a drag or a key changes it, null when it ends. It is not called for a change
     * the app made (`selectBars`, `clearSelection`, a new score, new bars or a track).
     */
    readonly onSelectionChange?: (selection: BeatSpan | null) => void;
    /** Saved settings, fitted to the score on load. Without them each track starts at its file's volume. */
    readonly mixer?: Mixer;
    /** Called with the new mixer after a user action changes it, not when the load fits it. */
    readonly onMixerChange?: (mixer: Mixer) => void;
    /** A saved zoom, used from the start. */
    readonly zoom?: number;
    /** Called with the new zoom after `setZoom`, not when the options or a width set it. */
    readonly onZoomChange?: (zoom: number) => void;
    /** A saved notation. It wins over the track's default on load; `setTrack` still resets to the default. */
    readonly notation?: Notation;
    /** Called with the new notation after `setNotation`, not when a load or `setTrack` sets it. */
    readonly onNotationChange?: (notation: Notation) => void;
    /**
     * Called with whole seconds of playing time not yet reported: about every five seconds while playing, and with the
     * rest when playback stops, pauses, finishes, or a new score loads. The app adds them up; the player keeps no total.
     */
    readonly onPracticeTime?: (seconds: number) => void;
}
/** The display settings the player writes: how large alphaTab draws, and how tightly it packs bars. */
export interface DisplaySettings {
    scale: number;
    stretchForce: number;
    /** The first bar drawn, counted from 1. */
    startBar: number;
    /** How many bars are drawn from `startBar`; -1 draws to the end. */
    barCount: number;
}
/** The part of an alphaTab `MasterBar` the controller reads. */
export interface PlayerMasterBar {
    /** The bar's first tick. */
    readonly start: number;
    calculateDuration(): number;
    readonly tempoAutomations: ReadonlyArray<{
        readonly value: number;
    }>;
}
/** The part of an alphaTab `Staff` the controller sets. */
export interface PlayerStaff {
    readonly isStringed: boolean;
    readonly isPercussion: boolean;
    showStandardNotation: boolean;
    showTablature: boolean;
}
/** The part of an alphaTab `Track` the controller reads. */
export interface PlayerTrack {
    readonly index: number;
    readonly name: string;
    readonly shortName: string;
    readonly isPercussion: boolean;
    /** `volume` is the file's own track volume, 0 to 16; `program` is the General MIDI program. */
    readonly playbackInfo: {
        readonly volume: number;
        readonly program: number;
    };
    readonly staves: ReadonlyArray<PlayerStaff>;
}
/** An alphaTab event without a payload, as the API exposes it. */
export interface PlayerEvent {
    on(handler: () => void): () => void;
}
/** An alphaTab event with a payload. */
export interface PlayerEventOf<T> {
    on(handler: (value: T) => void): () => void;
}
/**
 * The part of `AlphaTabApi` the controller touches. `AlphaTabApi` satisfies it as is; a test can pass
 * a plain object. A later feature adds the members it needs here, so this stays the smallest true list.
 */
export interface PlayerApi {
    readonly scoreLoaded: PlayerEventOf<{
        readonly tempo: number;
        readonly tracks: ReadonlyArray<PlayerTrack>;
        readonly masterBars: ReadonlyArray<PlayerMasterBar>;
    }>;
    readonly renderStarted: PlayerEventOf<boolean>;
    readonly postRenderFinished: PlayerEvent;
    /**
     * alphaTab's own handler, added before the controller's, puts each part into the host. A part with no
     * `renderResult` is a placeholder from the layout, not a drawing.
     */
    readonly renderer: {
        readonly partialRenderFinished: PlayerEventOf<{
            readonly renderResult: unknown;
        }>;
    };
    readonly playerReady: PlayerEvent;
    readonly playerStateChanged: PlayerEventOf<{
        readonly state: number;
    }>;
    readonly playerPositionChanged: PlayerEventOf<{
        readonly currentTime: number;
        readonly endTime: number;
    }>;
    /** Fires once per pass of the playing range. With `isLooping` set, each loop round fires it. */
    readonly playerFinished: PlayerEvent;
    readonly error: PlayerEventOf<{
        readonly message: string;
    }>;
    /** Fires when the container's width changes; alphaTab then applies `settings` and redraws once. */
    readonly resize: PlayerEventOf<{
        readonly newWidth: number;
        readonly settings: {
            readonly display: DisplaySettings;
        } | null;
    }>;
    readonly container: {
        readonly width: number;
    };
    /** Returns false when alphaTab cannot read the data type. */
    load(scoreData: unknown): boolean;
    tex(tex: string): void;
    /** Draws a parsed score's first track, and fires `scoreLoaded` when the score is new to this API. */
    renderScore(score: model.Score): void;
    play(): boolean;
    pause: () => void;
    playPause: () => void;
    stop: () => void;
    timePosition: number;
    metronomeVolume: number;
    countInVolume: number;
    playbackSpeed: number;
    isLooping: boolean;
    masterVolume: number;
    /** Takes effect only once the player exists: alphaTab drops these three before `playerReady`. */
    changeTrackVolume(tracks: PlayerTrack[], volume: number): void;
    changeTrackSolo(tracks: PlayerTrack[], solo: boolean): void;
    changeTrackMute(tracks: PlayerTrack[], mute: boolean): void;
    readonly settings: {
        readonly display: DisplaySettings;
        readonly player: {
            playerMode: PlayerMode;
        };
    };
    /** Applies `settings` to the renderer and, when `playerMode` changed, replaces the player; it does not draw. */
    updateSettings(): void;
    /** Draws the loaded score again with the current settings. */
    render(): void;
    /** Draws only these tracks. The sound is unchanged: alphaTab makes the MIDI from the whole score. */
    renderTracks(tracks: PlayerTrack[]): void;
    /** The tracks drawn now: the beats the keyboard moves over. */
    readonly tracks: ReadonlyArray<model.Track>;
    /** The ticks the player plays; null for the whole score. Setting it fires `playbackRangeChanged`. */
    playbackRange: {
        readonly startTick: number;
        readonly endTick: number;
    } | null;
    tickPosition: number;
    /** Marks a selection without playing it; `applyPlaybackRangeFromHighlight` then makes it the range. */
    highlightPlaybackRange(startBeat: model.Beat, endBeat: model.Beat): void;
    applyPlaybackRangeFromHighlight(): void;
    clearPlaybackRangeHighlight(): void;
    scrollToCursor(): void;
    /** Fires after a drag or `applyPlaybackRangeFromHighlight`, once the highlight event has told which beats. */
    readonly playbackRangeChanged: PlayerEventOf<{
        readonly playbackRange: unknown;
    }>;
    /** The beats of the marked selection; both are missing when it is cleared. */
    readonly playbackRangeHighlightChanged: PlayerEventOf<{
        readonly startBeat?: model.Beat;
        readonly endBeat?: model.Beat;
    }>;
}
/**
 * Drives `api`: it listens to alphaTab's events and keeps the state from them, and its actions call the API.
 *
 * Event order matters: `scoreLoaded` makes the state ready before the first draw, `renderStarted` and
 * `postRenderFinished` bracket each draw, and `playerReady` comes later and on its own timing, since the
 * sound font loads in parallel. An `error` event is final until the next `load`.
 *
 * The position comes from `playerPositionChanged` only. `stop` and `seek` set it directly, because a
 * stopped or paused player may not emit that event for the move.
 *
 * The trainer's loop count lives here, not in the state: it is progress, not a setting. Stop, seek, a
 * loop toggle and a speed the player chose restart it, so a count never carries across a jump.
 *
 * The scale is the user's zoom on the base for the host's width (`displayForWidth`); until the host's width is known
 * the base is the full-width one. A redraw happens only when the scale or stretch changed, and
 * only once a score is loaded: before that the settings are set and the first draw uses them.
 *
 * Sound loads on demand. The API starts in external-media mode (cursor, seek and selection, no audio), and the first
 * `play` or `playPause` switches it to the synthesizer and plays once `playerReady` says the sound font is loaded.
 * The switch replaces alphaTab's player, which keeps the volumes, speed and loop but not the position, so that is put
 * back at `playerReady`. alphaTab also fires `playerReady` in external-media mode, once the MIDI is loaded; that
 * event has no synthesizer behind it, so only the range is set again (below) while `sound` is `off`.
 *
 * The playback range is the selection's bars, else the drawn bars (`options.bars`), else none (the whole score).
 * alphaTab loads each MIDI into a new sequencer that has no range, so this controller sets the range again at every
 * `playerReady`. It sets the range and recognises the change event of each range it sets by the ticks, so only a
 * drag or a key reaches `onSelectionChange`. Keys and the selection reach the drawn bars only.
 *
 * Practice time counts from alphaTab's Playing state, and is measured with `now` (milliseconds; a test passes a
 * fake clock). It is reported at position events, so no timer runs here.
 *
 * `options.trackLabel` and the `on...Change` callbacks are read when they are needed, not at creation, so a
 * caller can pass an object whose getters return its latest callbacks.
 */
export declare function createScorePlayer(api: PlayerApi, options?: ScorePlayerOptions, now?: () => number): ScorePlayer;
