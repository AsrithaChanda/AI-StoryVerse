export type NarrativeBeat = { id: string; description: string; caption: string };
export type StoryFlowItem<T extends NarrativeBeat> = { paragraph: string; beats: T[] };

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "almost", "among", "around", "because", "before", "being", "between", "could", "every", "from", "have", "into", "just", "like", "more", "only", "other", "over", "same", "some", "than", "that", "their", "there", "these", "they", "this", "through", "under", "when", "where", "which", "while", "with", "would",
]);

function cleanParagraph(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentences(value: string): string[] {
  return (value.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map(cleanParagraph).filter(Boolean);
}

function tokens(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

/** Turns generator prose into comfortably paced reader paragraphs. Explicit
 * paragraph breaks are retained; a dense block is split by sentence rhythm. */
export function splitNarrationIntoParagraphs(narration: string, minimumParagraphs = 2): string[] {
  const source = narration.replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const explicit = source.split(/\n\s*\n+/).map(cleanParagraph).filter(Boolean);
  const allSentences = explicit.flatMap(sentences);
  const desired = Math.min(Math.max(2, minimumParagraphs), allSentences.length);
  if (explicit.length >= desired || allSentences.length < 2) return explicit;

  const paragraphs: string[] = [];
  let cursor = 0;
  for (let group = 0; group < desired; group += 1) {
    const remainingSentences = allSentences.length - cursor;
    const remainingGroups = desired - group;
    const size = Math.ceil(remainingSentences / remainingGroups);
    paragraphs.push(allSentences.slice(cursor, cursor + size).join(" "));
    cursor += size;
  }
  return paragraphs;
}

/** Keeps image beats in chronological order while favoring paragraphs with
 * shared story terms. Images are inserted before the final paragraph whenever
 * there is enough text, so the ending remains a clean reading beat. */
export function buildStoryFlow<T extends NarrativeBeat>(narration: string, beats: T[]): StoryFlowItem<T>[] {
  const paragraphs = splitNarrationIntoParagraphs(narration, Math.min(6, Math.max(2, beats.length + 1)));
  if (paragraphs.length === 0) return [];

  const flow = paragraphs.map((paragraph) => ({ paragraph, beats: [] as T[] }));
  const lastInsertIndex = Math.max(0, flow.length - 2);
  const keepSeparate = beats.length <= lastInsertIndex + 1;
  let earliestIndex = 0;

  beats.forEach((beat, beatIndex) => {
    const remainingBeats = beats.length - beatIndex - 1;
    const latestIndex = keepSeparate ? Math.max(earliestIndex, lastInsertIndex - remainingBeats) : lastInsertIndex;
    const preferredIndex = Math.min(lastInsertIndex, Math.floor(((beatIndex + 1) * (lastInsertIndex + 1)) / (beats.length + 1)));
    const beatTokens = tokens(`${beat.description} ${beat.caption}`);
    let selectedIndex = earliestIndex;
    let highestScore = Number.NEGATIVE_INFINITY;

    for (let index = earliestIndex; index <= latestIndex; index += 1) {
      const sharedTerms = [...beatTokens].filter((word) => tokens(flow[index].paragraph).has(word)).length;
      const proximity = Math.max(0, 8 - Math.abs(index - preferredIndex) * 4);
      const score = sharedTerms * 16 + proximity;
      if (score > highestScore) {
        selectedIndex = index;
        highestScore = score;
      }
    }

    flow[selectedIndex].beats.push(beat);
    earliestIndex = keepSeparate ? selectedIndex + 1 : selectedIndex;
  });

  return flow;
}
