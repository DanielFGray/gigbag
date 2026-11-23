import type { MusicalKey } from "./key.ts";
import { type ScoreLinkReading } from "./score-link.ts";
/**
 * One drawable piece of a chart line. `start` and `end` are its range in the
 * anchor text of the stored chart (see doc.ts), which marks anchor to; they do
 * not change when the chart is shown in another key.
 */
export type ChartItem = {
    readonly start: number;
    readonly end: number;
} & ({
    kind: "pair";
    chord: string;
    lyric: string;
}
/** `writtenIn` is set on a tab section drawn in another key: its tab is shown as written, in that key. */
 | {
    kind: "section";
    label: string;
    writtenIn?: string;
} | {
    kind: "comment";
    text: string;
}
/** A line of ASCII tab, kept exactly as written: its columns are the music. */
 | {
    kind: "tab";
    text: string;
}
/**
 * A phrase: `tex` is its alphaTex (docs/adr/0003). Its range covers its
 * name and every line of its notation. `writtenIn` is set when the chart is
 * drawn in another key, since the notation is drawn as written.
 */
 | {
    kind: "phrase";
    name: string;
    tex: string;
    writtenIn?: string;
}
/** A score link (docs/adr/0004): the bars of a score chart, drawn in place. */
 | {
    kind: "score";
    reading: ScoreLinkReading;
});
/**
 * A drawn chart line; an empty one is a blank line. A directive that draws
 * nothing (`{key}`, a section's end) gives no line, and a phrase's lines give
 * one line holding the phrase.
 */
export type ChartLine = ReadonlyArray<ChartItem>;
/**
 * The stored chart, drawn in `shownKey`.
 *
 * ChordSheetJS moves every chord by the interval between the written key and
 * the shown key and keeps each chord's quality, so a shown key in the other
 * mode gives the same chords moved by that interval. A chart with no written
 * key cannot move and is returned as written.
 */
export declare function renderLyrics(source: string, shownKey?: string | null): ReadonlyArray<ChartLine>;
/** The distinct chord names of a rendered chart, in the order each first appears. */
export declare function chartChords(lines: ReadonlyArray<ChartLine>): ReadonlyArray<string>;
/**
 * Chords a player is likely to drop in a chart written in `key`: the chords
 * built on its scale, spelled the way that key spells them. They come from a
 * template written in C (or A minor) and moved with the same transposition the
 * chart uses, so the spelling rules live in one place.
 */
export declare function suggestedChords(key: string): ReadonlyArray<string>;
/**
 * Whether `name` can be written between `[` and `]` in a chart as one chord:
 * no brackets, whitespace or control characters, which would change the line
 * around it, and a name ChordSheetJS reads as a chord.
 */
export declare function isChordName(name: string): boolean;
/** `{start_of_tab}` and its short form `{sot}`. */
export declare function isTabStart(directiveName: string): boolean;
/**
 * A phrase is stored as a ChordPro textblock (docs/adr/0003): the only section
 * whose lines ChordSheetJS neither parses nor transposes, which alphaTex needs.
 */
export declare function isPhraseStart(directiveName: string): boolean;
/** The start of a section whose lines ChordSheetJS keeps as written: tab or a phrase. */
export declare function isLiteralStart(directiveName: string): boolean;
/** The end of a section whose lines ChordSheetJS keeps as written. */
export declare function isLiteralEnd(directiveName: string): boolean;
/**
 * Turns pasted chords-over-lyrics text into the stored chart text (ChordPro).
 * Each chord goes into the lyric line under it at the column it was typed at.
 * The lyrics are kept exactly, except that `[ ] { }` become parentheses because
 * ChordPro reads them as chord and directive syntax. Header lines (`[Chorus]`,
 * `Verse 1:`) start sections.
 *
 * A run of ASCII tab lines becomes a tab section, kept exactly, with a chord
 * row typed just above a tab line kept in it so the chords stay over their
 * notes. Sections do not nest, so a tab run ends the section it is in; when
 * nothing came between a header and the tab, the tab section takes the
 * header's label.
 *
 * A line of directives that the form writes no other way is kept exactly as
 * written: a comment, a phrase's textblock (docs/adr/0003) and any other
 * directive outside the form's own grammar. Sections are written as `[Header]`
 * lines and the key comes from `writtenKey`, so `{start_of_verse}`, `{key}`
 * and friends are read as words, like any other line the form does not know.
 * Inside a phrase every line is kept, since alphaTex may hold anything.
 *
 * ChordSheetJS's own chords-over-words parsers are not used: on real pastes its
 * Ultimate Guitar parser drops spaces from lyrics, and neither parser turns
 * `[Verse 1]` into a section.
 *
 * Round trip: importPasted(exportChords(source, key), key) is byte-equal for
 * every chart importPasted makes. For a chart the drag editor wrote, the
 * labelled sections keep the same anchor text and the drawn chart is the same.
 */
export declare function importPasted(text: string, writtenKey?: string | null): string;
/**
 * The stored chart as chords over lyrics, drawn in `shownKey`: the form
 * `importPasted` reads, so a chart can be copied out and pasted back in.
 *
 * Each chord sits on the row above the word it belongs to. A chord that would
 * touch the one before it moves right to leave a space, and a chord-only line
 * is followed by a blank line so the importer does not pair it with the lyrics
 * or tab below. Tab lines are written as stored, and a section with no label
 * gets no header line.
 *
 * A phrase and every other directive the form keeps are written as the stored
 * lines themselves, so they come back unchanged; a section is written as a
 * `[Header]` line, which the importer turns back into the section it came from.
 * The chart's key is not written: the form carries it as the key the player
 * chose, which is the argument `importPasted` takes.
 *
 * Round trip: importPasted(exportChords(source, key), key) is byte-equal for
 * every chart importPasted makes. For a chart the drag editor wrote, the
 * labelled sections keep the same anchor text and the drawn chart is the same.
 */
export declare function exportChords(source: string, shownKey?: string | null): string;
/**
 * A chord-only line (an intro, a turnaround, a solo's changes) as ChordPro:
 * each chord at its column over blank text, so the line keeps the spacing it
 * was written with. `line` must pass `isChordLine`.
 */
export declare function chordLineSource(line: string): string;
/**
 * Pasted text as lines to put inside a chart that already exists: what
 * `importPasted` makes of it, without the song's details (key, title, artist,
 * tempo and the like), which belong to the chart and not to a passage of it.
 */
export declare function pastedPassage(text: string): string;
/**
 * True for a line of ASCII tab (`e|--0--3h5--|`): an optional string name,
 * then dashes, frets, bar lines and technique letters, with at least four
 * dashes making up a third of it, and a bar line or a string name.
 */
export declare function isTabLine(line: string): boolean;
/** True when every token on the line is a chord or a chart symbol (bar lines, repeats, N.C.). */
export declare function isChordLine(line: string): boolean;
/**
 * True when a song has a chart of chords over lyrics. A score draws no chord
 * names, so the chord controls belong to a lyrics chart and to nothing else.
 * Every place that shows them asks here, so they appear and go together.
 */
export declare const hasLyricsChart: (list: ReadonlyArray<{
    readonly kind: string;
}>) => boolean;
/**
 * Guesses the key a chart was written in from its chords, for a chart saved
 * without one; null when no chord can be read. It uses the Krumhansl-Schmuckler
 * key-finding algorithm: build a pitch-class histogram from the chords' roots,
 * thirds and fifths, then pick the key whose Krumhansl key profile correlates
 * best with it.
 *
 * Krumhansl, C. L. (1990). Cognitive Foundations of Musical Pitch.
 * Oxford University Press.
 */
export declare function guessKey(text: string): MusicalKey | null;
/**
 * The key `guessKey` finds for chords given as root pitch classes, named as
 * players write it (`KEY_NAMES`): Ab, not G#.
 */
export declare function keyOfChords(chords: ReadonlyArray<{
    readonly root: number;
    readonly minor: boolean;
}>): MusicalKey | null;
