/**
 * Text-to-speech service contract.
 *
 * Core provides **no** TTS implementation — the `tts` service key is filled by a
 * plugin (RPNow ships the MiMo TTS `.rpnx`). This keeps speech entirely optional
 * and replaceable: provide the same key with another engine and the UI switches
 * over with no other change.
 *
 * The contract is deliberately small so a provider only has to answer two
 * questions: "what can you say?" and "speak this text".
 */

export interface TTSVoice {
  id: string;
  label: string;
  /** BCP-47-ish language hint, e.g. `zh-CN`. Optional. */
  language?: string;
  description?: string;
}

export interface TTSRequest {
  text: string;
  /** Voice id from {@link TTSVoice}. Falls back to the provider default. */
  voice?: string;
  /** Named style presets the provider groups voices under. */
  style?: string;
  /** Provider-specific extra instructions (MiMo: a separate user message). */
  instruction?: string;
  signal?: AbortSignal;
}

export interface TTSResult {
  /** Playable audio, typically a data URL (audio/wav, audio/mpeg). */
  audio: string;
  format: string;
  voice?: string;
  /** Anything the provider wants to surface (token usage, model, …). */
  meta?: Record<string, unknown>;
}

export interface TTSService {
  /** Human-readable provider name for the settings UI. */
  readonly label: string;
  /** Whether a usable credential/configuration is present. */
  ready(): boolean;
  voices(): TTSVoice[];
  /** Synthesize one utterance. */
  speak(req: TTSRequest): Promise<TTSResult>;
  /** Optional: active playback control, implemented by the shell/UI. */
  stop?(): void;
}

/**
 * Strip roleplay markup so only speakable prose remains.
 *
 * Chat messages contain HTML, markdown emphasis, CSS blocks, and card-specific
 * XML tags; reading them aloud verbatim is unlistenable. This removes those
 * while keeping the narration and dialogue text intact.
 */
export function extractSpeakableText(
  input: string,
  options: { maxChars?: number; charName?: string; userName?: string } = {},
): string {
  if (!input) return '';
  let text = input;

  // 0. Resolve the identity macros that appear in stored message text. They are
  //    substituted at prompt time but the transcript keeps the raw form, so a
  //    reader would otherwise pronounce "{{char}}" literally.
  if (options.charName) text = text.replace(/\{\{char\}\}/g, options.charName);
  if (options.userName) text = text.replace(/\{\{user\}\}/g, options.userName);
  // Drop any remaining macro syntax ({{random::a::b}} → inner text) so nothing
  // speaks a curly brace.
  text = text.replace(/\{\{[^}]*\}\}/g, ' ');

  // 1. Drop everything that is markup rather than prose.
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  // Custom card tags (<status>, <xy-dialog>, <char_thought>…) carry a tag-like
  // token; drop the tags but keep their inner text.
  text = text.replace(/<\/?[a-z][^>]{0,200}>/gi, ' ');
  // HTML comments and fenced code blocks.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/```[\s\S]*?```/g, ' ');

  // 2. Markdown: keep words, drop syntax.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // images
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // links → label
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, ''); // headings
  text = text.replace(/^\s{0,3}>\s?/gm, ''); // blockquotes
  text = text.replace(/^\s*[-*+]\s+/gm, ''); // list bullets
  text = text.replace(/^\s*\d+\.\s+/gm, ''); // ordered lists
  text = text.replace(/(\*\*|__|\*|_|~~|`)/g, ''); // emphasis / code ticks
  text = text.replace(/^\s*([-*_])\1{2,}\s*$/gm, ' '); // horizontal rules

  // 3. Collapse whitespace into readable pauses. Para­graph breaks become a
  //    sentence stop so the reader pauses between beats, but single newlines
  //    (common inside dialogue) stay as spaces to keep an utterance whole.
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, ' ')
    // A paragraph break right after existing punctuation would double the stop.
    .replace(/([。！？.!?])\s*[。]+/g, '$1')
    .trim();

  // 4. Trim to a sensible utterance length so a long reply is not one giant
  //    request (providers cap input, and a single wave sounds robotic).
  const max = options.maxChars ?? 1200;
  if (text.length > max) {
    // Prefer cutting at sentence punctuation near the limit.
    const slice = text.slice(0, max);
    const cut = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('. '),
    );
    text = cut > max * 0.5 ? slice.slice(0, cut + 1) : slice;
  }
  return text.trim();
}

/**
 * Split speakable text into utterance-sized chunks at sentence boundaries.
 *
 * Sentences are always separated (never merged just because they would fit):
 * each request starts playing as soon as it returns, so finer granularity means
 * faster first audio. `maxChars` only caps how long a single utterance may grow
 * before an over-long sentence is broken further.
 */
export function splitIntoUtterances(text: string, maxChars = 220): string[] {
  if (!text) return [];

  // Walk the string character by character and cut only where a sentence really
  // ends. A `.` only ends a sentence when followed by whitespace, and a cut is
  // deferred while inside an open 「」/“”/() pair — otherwise Chinese roleplay
  // («「坐吧。要热的」») gets chopped into fragments the reader pronounces with
  // unnatural breaks.
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  const OPEN = '「『（(“‘[【';
  const CLOSE = '」』）)”’]】';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    current += ch;
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);

    const isCjkEnd = '。！？!?'.includes(ch);
    const isLatinEnd = ch === '.' && /\s/.test(text[i + 1] ?? '');
    if ((isCjkEnd || isLatinEnd) && depth === 0) {
      // Pull in any trailing closing quotes so they stay with their sentence.
      while (i + 1 < text.length && CLOSE.includes(text[i + 1])) {
        current += text[++i];
      }
      segments.push(current);
      current = '';
    }
  }
  if (current.trim()) segments.push(current);

  const sentences = segments.map((s) => s.trim()).filter(Boolean);

  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    // Hard-break an over-long sentence at punctuation or, failing that, on a
    // fixed stride so no single request exceeds the cap.
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cutAt = Math.max(
        window.lastIndexOf('，'),
        window.lastIndexOf(','),
        window.lastIndexOf('、'),
        window.lastIndexOf(' '),
      );
      const cut = cutAt > maxChars * 0.5 ? cutAt + 1 : maxChars;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}
