/**
 * The lyrics chart as the editor sees it: lines, each a ChordPro directive, a
 * lyric with chords placed at columns, or a literal line: a line of tab or of
 * a phrase's notation, kept as written.
 *
 * Every edit returns the new chart and the change set that turns the old
 * anchor text into the new one (docs/adr/0001). The editor knows exactly what
 * it changed, so marks anchored in the chart follow an edit without guessing.
 *
 * The anchor text is the chart's text with each chord written `[C]` where it
 * sits, lines joined by newlines; a section start contributes its label. It is
 * derived from the stored text, never stored.
 */
import { type Change } from "./changes.ts";
export type PlacedChord = {
    readonly at: number;
    readonly chord: string;
};
export type DocLine = {
    readonly kind: "directive";
    readonly raw: string;
} | {
    readonly kind: "lyrics";
    readonly text: string;
    readonly chords: ReadonlyArray<PlacedChord>;
}
/** A line inside a tab section or a phrase: brackets in it are notation, not chords. */
 | {
    readonly kind: "literal";
    readonly text: string;
};
export type ChartDoc = ReadonlyArray<DocLine>;
/** An edited chart and the change set from the anchor text before the edit to the one after it. */
export type Edit = {
    readonly doc: ChartDoc;
    readonly changes: Array<Change>;
};
/** A stretch of a lyric line a chord can be dropped on: a word with the space after it. */
type Segment = {
    readonly start: number;
    readonly end: number;
    readonly chords: ReadonlyArray<number>;
};
export declare function parseDoc(source: string): ChartDoc;
export declare function serializeDoc(doc: ChartDoc): string;
/** The anchor text of the whole chart. */
export declare function anchorText(doc: ChartDoc): string;
export declare function anchorLine(line: DocLine): string;
/**
 * The word-sized stretches of a lyric line, split further where a chord sits
 * inside a word. A chord-only line has no words, so it also has an empty
 * stretch past its last chord, where the next chord of the passage goes.
 */
export declare function segments(line: Extract<DocLine, {
    kind: "lyrics";
}>): ReadonlyArray<Segment>;
/** True for a lyric line with chords and no words: an intro, a turnaround, a solo's changes. */
export declare function isChordOnly(line: DocLine): boolean;
/**
 * A chord-only line as a player types it: each chord name at its column, with
 * at least one space between names. `chordLineSource` reads it back.
 */
export declare function chordLineText(line: Extract<DocLine, {
    kind: "lyrics";
}>): string;
/**
 * Puts `chord` on the stretch of `lineIndex` that starts at column `at`,
 * replacing the chord already there.
 */
export declare function placeChord(doc: ChartDoc, lineIndex: number, at: number, chord: string): Edit;
export declare function removeChord(doc: ChartDoc, lineIndex: number, chordIndex: number): Edit;
/** Takes a chord off one stretch and drops it on another, possibly on another line. */
export declare function moveChord(doc: ChartDoc, source: {
    line: number;
    chord: number;
}, target: {
    line: number;
    at: number;
}): Edit;
/**
 * Replaces the text of a lyric or literal line. On a lyric line, chords stay on
 * the text around the edit; a chord inside the replaced stretch moves to its
 * start, and a chord where text is only inserted goes with the text after it. The change is the
 * common-prefix-and-suffix replacement, which is exact except where the edit
 * sits inside a repeat within the one line.
 */
export declare function editLine(doc: ChartDoc, lineIndex: number, text: string): Edit;
/** Puts a chord-only line, read from `text` as a player types it (`G  C  D`), after `lineIndex`. */
export declare function addChordLine(doc: ChartDoc, lineIndex: number, text: string): Edit;
/**
 * Gives the chord-only line at `lineIndex` the chords of `text`, as a player
 * types them; blank text leaves a blank line. The change is the replacement
 * between the common start and end of the line's old and new anchor text.
 */
export declare function setChordLine(doc: ChartDoc, lineIndex: number, text: string): Edit;
/**
 * Where lines pasted below `lineIndex` go, as the index the first of them
 * takes. Sections do not nest, and nothing enters a tab or a phrase, so a
 * paste that holds a section start, or one below a line of a tab or a phrase,
 * goes after the end of the section it would land in; `moved` says so.
 */
export declare function pasteTarget(doc: ChartDoc, lineIndex: number, source: string): {
    at: number;
    moved: boolean;
};
/**
 * Puts ChordPro `source` (from `pastedPassage`) below the line at `lineIndex`,
 * or where `pasteTarget` moves it. The lines are new text, so the change set
 * is one insertion and marks around it stay on their words.
 */
export declare function pasteAfter(doc: ChartDoc, lineIndex: number, source: string): Edit;
/** Adds an empty lyric line after `lineIndex`. */
export declare function insertLineAfter(doc: ChartDoc, lineIndex: number): Edit;
/**
 * Deletes a lyric, literal or score link line with the newline that separates it from its neighbour.
 * A section start is not one line: it goes with its section through deleteBlock.
 */
export declare function deleteLine(doc: ChartDoc, lineIndex: number): Edit;
/** Renames a section; the label is the anchor text of its start line. */
export declare function renameSection(doc: ChartDoc, lineIndex: number, label: string): Edit;
/**
 * Starts a section at `lineIndex`. Inside a section it splits it in two of the
 * same kind, so the section's own end line closes the new half; elsewhere it
 * opens a verse that ends before the next directive or at the end of the chart.
 */
export declare function addSection(doc: ChartDoc, lineIndex: number, label: string): Edit;
/**
 * Removes a section's start and end lines; its lines stay where they are. A
 * tab section or a phrase goes with its lines, since literal lines exist only
 * inside one.
 */
export declare function removeSection(doc: ChartDoc, lineIndex: number): Edit;
/** The name of a directive line (`start_of_tab` for `{start_of_tab: Intro}`), or "" for any other line. */
export declare function directiveName(line: DocLine): string;
/** True for a line of a phrase's notation, which the editor shows as the drawn phrase. */
export declare function inPhrase(doc: ChartDoc, lineIndex: number): boolean;
/** The phrase whose start line is at `lineIndex`: its name and its alphaTex. */
export declare function phraseAt(doc: ChartDoc, lineIndex: number): {
    name: string;
    tex: string;
};
/**
 * Puts a phrase after the line at `lineIndex`. Sections do not nest, so inside
 * a section the phrase splits it, and the second half continues with no label;
 * after a section's last line the phrase goes after the section.
 */
export declare function addPhrase(doc: ChartDoc, lineIndex: number, name: string, tex: string): Edit;
/** Gives the phrase whose start line is at `lineIndex` a new name and new alphaTex. */
export declare function setPhrase(doc: ChartDoc, lineIndex: number, name: string, tex: string): Edit;
/** Puts a score link (docs/adr/0004) below the line at `lineIndex`. `value` is the directive's text after `score:`. */
export declare function addScoreLink(doc: ChartDoc, lineIndex: number, value: string): Edit;
/**
 * The lines a handle moves as one: a section from its start line through its
 * end line (or through the line before the next section, when it has no end),
 * with the loose lines after its end line, up to the next section: any line
 * that is not a section start (comments, blank lines, lyrics) belongs to the
 * section above. A line inside a tab or a phrase
 * stands for that whole section. Any other line is a block of its own.
 */
export declare function blockRange(doc: ChartDoc, lineIndex: number): {
    start: number;
    end: number;
};
/** Whether the editor gives the line a handle: a lyric line, the start of a section, or a score link. */
export declare function hasHandle(doc: ChartDoc, lineIndex: number): boolean;
/**
 * The two slots a drop on the line's row can mean: before the row, or after it.
 * A section's heading is followed by the section's first line; a tab or a phrase,
 * which nothing can enter, is followed by whatever comes after its end line.
 */
export declare function dropSlots(doc: ChartDoc, lineIndex: number): {
    before: number;
    after: number;
};
/**
 * Whether the block at `lineIndex` can move to stand before line `destination`
 * (`doc.length` is the end). It cannot stay where it is, go inside a tab or a
 * phrase, or, for a section, go inside another section.
 */
export declare function canMoveBlockTo(doc: ChartDoc, lineIndex: number, destination: number): boolean;
/**
 * Moves the block at `lineIndex` to stand before line `destination`. The text
 * is removed and written again; the insertion records the removed anchor text as
 * its source, so marks inside the block follow it.
 */
export declare function moveBlockTo(doc: ChartDoc, lineIndex: number, destination: number): Edit;
/**
 * Moves a block one step (-1 up, 1 down). A section steps past its neighbouring
 * section. A line steps past its neighbouring line, or across a section's start or
 * end line, which takes it out of or into that section; a tab or a phrase beside
 * it counts as one line. A step and the opposite step restore the chart.
 */
export declare function moveBlock(doc: ChartDoc, lineIndex: number, delta: -1 | 1): Edit;
/** Writes a copy of the block at `lineIndex` right after it. The copy is new text, with no source. */
export declare function duplicateBlock(doc: ChartDoc, lineIndex: number): Edit;
/** Deletes the block at `lineIndex`: for a section, its lines too. */
export declare function deleteBlock(doc: ChartDoc, lineIndex: number): Edit;
/** The section that `lineIndex` is inside (after its start line, before its end), or null. */
export declare function enclosingSection(doc: ChartDoc, lineIndex: number): {
    start: number;
    kind: string;
} | null;
export {};
