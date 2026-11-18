/**
 * Read-aloud control for one message.
 *
 * Lives in the message action row and stays hidden unless a TTS plugin is
 * active. Because it resolves the `tts` service from the kernel, installing or
 * disabling the MiMo plugin makes the button appear/disappear with no core
 * change — which is the point of the service-slot design.
 *
 * Behaviour:
 *   - click to speak / click again to stop,
 *   - extracts speakable prose (drops HTML, CSS, markdown, card tags),
 *   - splits into sentence-sized utterances and plays them in order so long
 *     replies start quickly instead of waiting for one huge request,
 *   - cancels any in-flight request when the user stops or navigates away.
 */

import * as React from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { SERVICE } from '@/core/plugin/kernel-types.js';
import { useKernelService } from '@/hooks/useKernel.js';
import {
  extractSpeakableText,
  splitIntoUtterances,
  type TTSService,
} from '@/core/tts/types.js';
import { toast } from '@/components/ui/toast.js';

/** Module-level so only one message can speak at a time across the transcript. */
let activeAudio: HTMLAudioElement | null = null;
let activeAbort: AbortController | null = null;
let stopActive: (() => void) | null = null;

export function stopSpeaking(): void {
  stopActive?.();
  activeAudio?.pause();
  activeAudio = null;
  activeAbort?.abort();
  activeAbort = null;
  stopActive = null;
}

/**
 * Speak one message through a resolved TTS service.
 *
 * Shared by the message action row's "更多" menu so read-aloud works without a
 * always-visible button. Returns immediately when there is nothing to say.
 */
export async function speakMessage(
  tts: TTSService,
  text: string,
  opts: { charName?: string; userName?: string } = {},
): Promise<void> {
  const prose = extractSpeakableText(text, opts);
  if (!prose) {
    toast.info('这条消息没有可朗读的文本');
    return;
  }
  const abort = new AbortController();
  activeAbort = abort;
  try {
    const sentences = splitIntoUtterances(prose, 220);
    const speakOne = (s: string) => tts.speak({ text: s, signal: abort.signal }).then((r) => r.audio);
    const queued: Array<Promise<string>> = [speakOne(sentences[0])];
    if (sentences[1]) queued.push(speakOne(sentences[1]));
    let cancelled = false;
    stopActive = () => {
      cancelled = true;
    };
    for (let i = 0; i < sentences.length; i++) {
      if (cancelled) break;
      if (i + 2 < sentences.length) queued.push(speakOne(sentences[i + 2]));
      const src = await queued[i];
      if (cancelled) break;
      await playAudio(src, abort.signal);
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      toast.error('朗读失败', err instanceof Error ? err.message : String(err));
    }
  } finally {
    stopActive = null;
    activeAbort = null;
  }
}

export function ReadAloudButton({
  text,
  label,
  charName,
  userName,
}: {
  text: string;
  label?: string;
  charName?: string;
  userName?: string;
}) {
  const tts = useKernelService<TTSService>(SERVICE.TTS);
  const [state, setState] = React.useState<'idle' | 'loading' | 'playing'>('idle');

  // Stop playback when the component unmounts (message deleted, chat switched).
  React.useEffect(() => stopSpeaking, []);

  if (!tts) return null;

  const play = async () => {
    if (state !== 'idle') {
      stopSpeaking();
      setState('idle');
      return;
    }

    const prose = extractSpeakableText(text, { charName, userName });
    if (!prose) {
      toast.info('这条消息没有可朗读的文本');
      return;
    }

    const abort = new AbortController();
    activeAbort = abort;
    setState('loading');

    try {
      const sentences = splitIntoUtterances(prose, 220);
      // Queue the next utterance while the current one plays so playback is
      // continuous rather than gap-per-sentence.
      const synthesised: Array<Promise<string>> = [];
      const speakOne = async (s: string): Promise<string> => {
        const res = await tts.speak({ text: s, signal: abort.signal });
        return res.audio;
      };      // Start the first two requests immediately, then keep the queue two deep.
      synthesised.push(speakOne(sentences[0]));
      if (sentences[1]) synthesised.push(speakOne(sentences[1]));

      let cancelled = false;
      stopActive = () => {
        cancelled = true;
      };

      setState('playing');
      for (let i = 0; i < sentences.length; i++) {
        if (cancelled) break;
        if (i + 2 < sentences.length) synthesised.push(speakOne(sentences[i + 2]));
        const src = await synthesised[i];
        if (cancelled) break;
        await playAudio(src, abort.signal);
      }
      if (!cancelled) setState('idle');
    } catch (err) {
      // Aborting is a normal user action, not an error.
      if ((err as Error).name !== 'AbortError') {
        toast.error('朗读失败', err instanceof Error ? err.message : String(err));
      }
      setState('idle');
    } finally {
      stopActive = null;
      activeAbort = null;
    }
  };

  const busy = state !== 'idle';
  return (
    <button
      type="button"
      aria-label={busy ? '停止朗读' : '朗读这条消息'}
      aria-pressed={busy}
      title={busy ? '停止朗读' : `朗读${label ? `（${label}）` : ''}`}
      onClick={() => void play()}
      className={
        busy
          ? 'flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-accent)] transition'
          : 'flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] transition hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg)]'
      }
    >
      {state === 'loading' ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : state === 'playing' ? (
        <Square className="size-3.5" aria-hidden="true" />
      ) : (
        <Volume2 className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/** Play one audio data URL and resolve when it finishes. */
function playAudio(src: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const audio = new Audio(src);
    activeAudio = audio;
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      audio.pause();
      cleanup();
      resolve();
    };
    signal.addEventListener('abort', onAbort);
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('音频播放失败'));
    };
    audio.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
