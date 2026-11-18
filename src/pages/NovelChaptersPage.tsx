/**
* Novel chapters (route `novel-chapters`).
*
* One job: the manuscript. Generate continuations, write blank chapters by
* hand, reorder, read, edit, rewrite, delete. The collapsed row stays clean
* (number / title / words / expand) — reorder lives in the expanded actions.
*/

import * as React from 'react';
import {
ArrowDown,
ArrowUp,
BookOpenText,
ChevronDown,
ChevronUp,
Copy,
Loader2,
Minus,
Pencil,
Plus,
Sparkles,
Square,
Trash2,
X,
} from 'lucide-react';
import { useApp} from '@/state/store.js';
import { useLLM} from '@/hooks/useKernel.js';
import { useNovelBook, ChapterBody, NovelTabBar, NovelBookIdentity} from './novel/shared.js';
import {
buildNovelContext,
countWords,
parseGeneratedChapter,
type NovelChapter,
type NovelComment,
} from '@/core/novel/types.js';
import { Button} from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea} from '@/components/ui/input';
import { Badge} from '@/components/ui/misc.js';
import { toast} from '@/components/ui/toast.js';
import { confirmAction} from '@/components/ui/confirm.js';
import type { Route} from '@/components/layout/AppShell.js';

const WORD_OPTIONS = [
{ value: 1500, label: '少 1500'},
{ value: 2500, label: '中 2500'},
{ value: 4000, label: '多 4000'},
];
const COUNT_OPTIONS = [
{ value: 1, label: '1 章'},
{ value: 3, label: '3 章'},
{ value: 5, label: '5 章'},
{ value: 10, label: '10 章'},
];

export function NovelChaptersPage({ route, onNavigate}: { route: Route; onNavigate: (r: Route) => void}) {
const { book, updateBook} = useNovelBook();
const connections = useApp((s) => s.llmConnections);
const settings = useApp((s) => s.settings);
const llm = useLLM();
const connection = connections.find((c) => c.id === settings.defaultConnectionId)?? connections[0];

const [generating, setGenerating] = React.useState(false);
const [streamText, setStreamText] = React.useState('');
const [wordCount, setWordCount] = React.useState(2500);
const [chapterCount, setChapterCount] = React.useState(1);
const [readingIndex, setReadingIndex] = React.useState<number | null>(null);
const [fontSize, setFontSize] = React.useState(17);
const abortRef = React.useRef<AbortController | null>(null);

if (!book) {
return (
<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
<BookOpenText className="size-10 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
<p className="text-[13px] text-[var(--rp-fg-muted)]">还没有书籍，先去书架新建一本。</p>
<Button className="rounded-full" onClick={() => onNavigate('novel')}>
去书架
</Button>
</div>
);
}

const stopGeneration = () => {
abortRef.current?.abort();
setGenerating(false);
};

const generate = async () => {
if (!llm ||!connection) {
toast.error('请先配置模型连接', '在「设置 → 在线」里选择服务商和模型');
return;
}
setGenerating(true);
setStreamText('');
const controller = new AbortController();
abortRef.current = controller;
try {
for (let n = 0; n < chapterCount; n++) {
const { system, user} = buildNovelContext(book);
let text = '';
const stream = llm.stream(connection.id, {
model: book.model || connection.defaultModel || '',
messages: [
{ role: 'system', content: system},
{ role: 'user', content: `${user}\n\n本章要求字数约 ${wordCount} 字。`},
],
stream: true,
temperature: 1.0,
signal: controller.signal,
});
for await (const ev of stream) {
if (ev.type === 'text') {
text += ev.delta;
setStreamText(text);
} else if (ev.type === 'error') {
throw new Error(ev.message);
}
}
const parsed = parseGeneratedChapter(text, book.chapters.length);
const chapter: NovelChapter = {
title: parsed.title,
content: parsed.content,
summary: parsed.summary,
wordCount: countWords(parsed.content),
comments: [],
isExpanded: true,
};
updateBook((b) => ({...b, chapters: [...b.chapters, chapter]}));
const fresh = useApp.getState().novel.books.find((x) => x.id === book.id)?? book;
Object.assign(book, fresh);
if (n < chapterCount - 1) await new Promise((r) => setTimeout(r, 1000));
}
toast.success('生成完成', `${chapterCount} 章已写入目录`);
} catch (err) {
if ((err as Error).name!== 'AbortError') {
toast.error('生成失败', err instanceof Error? err.message: String(err));
}
} finally {
setGenerating(false);
setStreamText('');
abortRef.current = null;
}
};

const regenerateChapter = async (index: number) => {
if (!(await confirmAction({ title: '确认操作', description: '重写将使用当前上下文生成新的内容并覆盖本章，确定吗？'}))) return;
const trimmed = {...book, chapters: book.chapters.slice(0, index)};
if (!llm ||!connection) return;
setGenerating(true);
try {
const { system, user} = buildNovelContext(trimmed);
let text = '';
const stream = llm.stream(connection.id, {
model: book.model || connection.defaultModel || '',
messages: [
{ role: 'system', content: system},
{ role: 'user', content: `${user}\n\n本章要求字数约 ${wordCount} 字。`},
],
stream: true,
temperature: 1.0,
});
for await (const ev of stream) {
if (ev.type === 'text') {
text += ev.delta;
setStreamText(text);
}
}
const parsed = parseGeneratedChapter(text, index);
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, i) =>
i === index
? {...c, title: parsed.title, content: parsed.content, summary: parsed.summary, wordCount: countWords(parsed.content)}
: c,
),
}));
toast.success('已重写本章');
} finally {
setGenerating(false);
setStreamText('');
}
};

const addBlankChapter = () => {
const n = book.chapters.length + 1;
const chapter: NovelChapter = {
title: `第 ${n} 章`,
content: '',
summary: '',
wordCount: 0,
comments: [],
isExpanded: true,
tempTitle: `第 ${n} 章`,
tempContent: '',
};
updateBook((b) => ({...b, chapters: [...b.chapters, chapter]}));
toast.success('已新建空白章节', '在下面直接写正文，点保存即可');
};

const moveChapter = (index: number, dir: -1 | 1) => {
const target = index + dir;
if (target < 0 || target >= book.chapters.length) return;
updateBook((b) => {
const chapters = [...b.chapters];
const [c] = chapters.splice(index, 1);
if (!c) return b;
chapters.splice(target, 0, c);
return {...b, chapters};
});
};

const generateComments = async (chapterIndex: number) => {
if (!llm ||!connection) return;
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, i) => (i === chapterIndex? {...c, isGeneratingComments: true}: c)),
}));
const chapter = book.chapters[chapterIndex];
const fullText = book.chapters.map((c, i) => `【第 ${i + 1} 章 ${c.title}】\n${c.content}`).join('\n\n');
try {
const res = await llm.complete(connection.id, {
model: book.commentModel || connection.defaultModel || '',
messages: [
{
role: 'system',
content: '你是网文读者评论区策划。根据全书和当前章节，写 8–12 条读者评论，输出 JSON 数组，每项含 username、content、location、likes、time。只输出 JSON。',
},
{ role: 'user', content: `全书：\n${fullText}\n\n当前章节（第 ${chapterIndex + 1} 章 ${chapter.title}）：\n${chapter.content}`},
],
temperature: 0.8,
});
const raw = (res.text?? '').replace(/^```(?:json)?\s*|```$/g, '').trim();
const parsed = JSON.parse(raw) as Array<Partial<NovelComment>>;
const comments: NovelComment[] = parsed.slice(0, 12).map((c) => ({
username: String(c.username?? '热心书友'),
content: String(c.content?? ''),
location: String(c.location?? '未知'),
likes: Number(c.likes?? Math.floor(Math.random() * 200)),
time: String(c.time?? '刚刚'),
level: 1 + Math.floor(Math.random() * 8),
replies: [],
}));
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, i) =>
i === chapterIndex? {...c, comments, isGeneratingComments: false, showComments: true}: c,
),
}));
} catch {
const fallback: NovelComment[] = (chapter.content || '暂无评论')
.split(/\r?\n/)
.map((line) => line.trim())
.filter(Boolean)
.slice(0, 12)
.map((line) => ({
username: '热心书友',
content: line,
location: '未知',
likes: Math.floor(Math.random() * 50),
time: '刚刚',
level: 2,
replies: [],
}));
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, i) =>
i === chapterIndex? {...c, comments: fallback, isGeneratingComments: false, showComments: true}: c,
),
}));
}
};

const reading = readingIndex!== null? book.chapters[readingIndex]: undefined;

return (
<div className="flex h-full min-h-0 flex-col">
<div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
<div className="space-y-3">
<div className="flex items-center gap-2">
<div className="min-w-0 flex-1">
<NovelBookIdentity book={book} />
</div>
{generating? (
<Button size="sm" variant="outline" className="shrink-0 rounded-full" onClick={stopGeneration}>
<Square className="size-3.5" aria-hidden="true" /> 停止
</Button>
): (
<Button size="sm" className="shrink-0 rounded-full" onClick={() => void generate()} disabled={!llm ||!connection}>
<Sparkles className="size-3.5" aria-hidden="true" /> 提笔续写
</Button>
)}
</div>

{streamText && (
<div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 px-3 py-2">
<p className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--rp-fg-muted)]">
<Loader2 className="size-3 animate-spin" aria-hidden="true" /> 正在生成…
</p>
<p className="rp-scroll max-h-28 overflow-auto text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">
{streamText}
</p>
</div>
)}

<div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3">
<div className="grid grid-cols-2 gap-3">
<div className="space-y-1">
<Label htmlFor="nv-wordcount">单章字数</Label>
<Select value={String(wordCount)} onValueChange={(v) => setWordCount(Number(v))}>
<SelectTrigger id="nv-wordcount">
<SelectValue />
</SelectTrigger>
<SelectContent>
{WORD_OPTIONS.map((o) => (
<SelectItem key={o.value} value={String(o.value)}>
{o.label}
</SelectItem>
))}
</SelectContent>
</Select>
</div>
<div className="space-y-1">
<Label htmlFor="nv-count">一次生成</Label>
<Select value={String(chapterCount)} onValueChange={(v) => setChapterCount(Number(v))}>
<SelectTrigger id="nv-count">
<SelectValue />
</SelectTrigger>
<SelectContent>
{COUNT_OPTIONS.map((o) => (
<SelectItem key={o.value} value={String(o.value)}>
{o.label}
</SelectItem>
))}
</SelectContent>
</Select>
</div>
</div>
<Button size="sm" variant="outline" className="mt-3 w-full rounded-full" onClick={addBlankChapter}>
<Plus className="size-3.5" aria-hidden="true" /> 新建空白章节，自己写
</Button>
</div>

{book.chapters.length === 0? (
<p className="py-8 text-center text-[12px] text-[var(--rp-fg-muted)]">
还没有章节。点上面「提笔续写」让 AI 写，或新建一章自己写。
</p>
): (
<ul className="space-y-2">
{book.chapters.map((chapter, i) => (
<li key={i} id={`novel-chapter-${i}`} className="overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
<div className="flex items-center gap-2 px-3 py-2.5">
<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--rp-bg-sunken)] text-[11px] font-semibold tabular-nums text-[var(--rp-fg-muted)]">
{i + 1}
</span>
<button
type="button"
className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] font-medium"
onClick={() => setReadingIndex(i)}
aria-label={`阅读第 ${i + 1} 章 ${chapter.title || '未命名章节'}`}
>
{chapter.title || '未命名章节'}
</button>
<span className="shrink-0 text-[10.5px] tabular-nums text-[var(--rp-fg-subtle)]">{chapter.wordCount} 字</span>
<Button
size="icon-sm"
variant="ghost"
className="shrink-0 rounded-full"
aria-label={chapter.isExpanded? '收起本章': '展开本章'}
onClick={() =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => ({...c, isExpanded: ci === i?!c.isExpanded: c.isExpanded})),
}))
}
>
{chapter.isExpanded? <ChevronUp className="size-3.5" aria-hidden="true" />: <ChevronDown className="size-3.5" aria-hidden="true" />}
</Button>
</div>

{chapter.showSummary && (
<div className="border-t border-[var(--rp-border)] px-3 py-2">
<Textarea
rows={2}
value={chapter.summary}
placeholder="本章剧情摘要..."
aria-label="章节摘要"
onChange={(e) =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => (ci === i? {...c, summary: e.target.value}: c)),
}))
}
/>
</div>
)}

{chapter.isExpanded && (
<div className="space-y-2 border-t border-[var(--rp-border)] px-3 py-2">
{chapter.tempContent!== undefined? (
<p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--rp-fg)]">
{chapter.tempContent}
</p>
): (
<ChapterBody content={chapter.content} />
)}
<div className="flex flex-wrap gap-1.5">
<Button size="sm" variant="ghost" className="rounded-full" onClick={() => setReadingIndex(i)}>
<BookOpenText className="size-3.5" aria-hidden="true" /> 阅读
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
onClick={() => {
const next = {...chapter, tempTitle: chapter.title, tempContent: chapter.content};
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => (ci === i? next: c)),
}));
}}
>
<Pencil className="size-3.5" aria-hidden="true" /> 编辑
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
onClick={() => {
void navigator.clipboard.writeText(`${chapter.title}\n\n${chapter.content}`);
toast.success('已复制本章');
}}
>
<Copy className="size-3.5" aria-hidden="true" /> 复制
</Button>
<Button size="sm" variant="ghost" className="rounded-full" onClick={() => void regenerateChapter(i)}>
<Sparkles className="size-3.5" aria-hidden="true" /> 重写
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
aria-label={chapter.showSummary? '收起摘要': '展开摘要'}
onClick={() =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => (ci === i? {...c, showSummary:!c.showSummary}: c)),
}))
}
>
{chapter.showSummary? <ChevronUp className="size-3.5" aria-hidden="true" />: <ChevronDown className="size-3.5" aria-hidden="true" />}
摘要
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
aria-label="上移一章"
disabled={i === 0}
onClick={() => moveChapter(i, -1)}
>
<ArrowUp className="size-3.5" aria-hidden="true" /> 上移
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
aria-label="下移一章"
disabled={i === book.chapters.length - 1}
onClick={() => moveChapter(i, 1)}
>
<ArrowDown className="size-3.5" aria-hidden="true" /> 下移
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full text-[var(--rp-danger)]"
onClick={async () => {
if (await confirmAction({ title: '确认操作', description: '确定删除本章？'})) {
updateBook((b) => ({...b, chapters: b.chapters.filter((_, ci) => ci!== i)}));
}
}}
>
<Trash2 className="size-3.5" aria-hidden="true" /> 删除
</Button>
</div>

{chapter.tempContent!== undefined && (
<div className="space-y-2 rounded-xl border border-[var(--rp-border)] p-2">
<div className="space-y-1.5">
<Label htmlFor={`nv-chapter-title-${i}`} required>
章节标题
</Label>
<Input
id={`nv-chapter-title-${i}`}
value={chapter.tempTitle?? ''}
onChange={(e) =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => (ci === i? {...c, tempTitle: e.target.value}: c)),
}))
}
/>
{(chapter.tempTitle?? '').trim() === '' && (
<p className="text-[11px] text-[var(--rp-danger)]">章节标题是必填的。</p>
)}
</div>
<Textarea
rows={10}
value={chapter.tempContent}
aria-label="章节正文"
onChange={(e) =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) => (ci === i? {...c, tempContent: e.target.value}: c)),
}))
}
/>
<div className="flex gap-1.5">
<Button
size="sm"
className="rounded-full"
onClick={() => {
const title = (chapter.tempTitle?? '').trim();
if (!title) {
toast.error('章节标题是必填的', '先给这一章起个标题');
return;
}
const content = (chapter.tempContent?? '').trim();
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) =>
ci === i
? {...c, title, content, wordCount: countWords(content), tempTitle: undefined, tempContent: undefined}
: c,
),
}));
toast.success('已保存');
}}
>
保存
</Button>
<Button
size="sm"
variant="ghost"
className="rounded-full"
onClick={() =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, ci) =>
ci === i? {...c, tempTitle: undefined, tempContent: undefined}: c,
),
}))
}
>
取消
</Button>
</div>
</div>
)}

{/* Comments */}
<div className="rounded-xl border border-dashed border-[var(--rp-border)] p-2">
<div className="flex items-center justify-between">
<p className="text-[11.5px] font-semibold text-[var(--rp-fg-muted)]">本章书评</p>
<Button
size="sm"
variant="ghost"
className="rounded-full"
disabled={chapter.isGeneratingComments}
onClick={() => void generateComments(i)}
>
{chapter.isGeneratingComments? (
<Loader2 className="size-3 animate-spin" aria-hidden="true" />
): (
<Sparkles className="size-3" aria-hidden="true" />
)}
{chapter.comments.length? '重新生成': '生成书评'}
</Button>
</div>
{chapter.comments.length === 0 &&!chapter.isGeneratingComments && (
<p className="py-2 text-[11px] text-[var(--rp-fg-subtle)]">暂无评论，快来抢沙发~</p>
)}
<ul className="mt-1 space-y-1.5">
{chapter.comments.map((comment, ci) => (
<li key={ci} className="text-[11.5px]">
<span className="font-medium">{comment.username}</span>
<span className="ml-1 text-[var(--rp-fg-subtle)]">Lv.{comment.level}</span>
{ci === 0 && <Badge variant="accent" className="ml-1">热评</Badge>}
{comment.authorLiked && (
<Badge variant="outline" className="ml-1">作者赞过</Badge>
)}
<span className="ml-1 text-[var(--rp-fg-subtle)]">
{ci + 1}L · {comment.time} · IP属地：{comment.location}
</span>
<p className="mt-0.5 text-[var(--rp-fg)]">{comment.content}</p>
<button
type="button"
onClick={() =>
updateBook((b) => ({
...b,
chapters: b.chapters.map((c, xi) =>
xi === i
? {
...c,
comments: c.comments.map((cm, cmi) =>
cmi === ci? {...cm, likes: cm.likes + (cm.liked? -1: 1), liked:!cm.liked}: cm,
),
}
: c,
),
}))
}
className="mt-0.5 inline-flex cursor-pointer items-center gap-1 text-[10.5px] text-[var(--rp-fg-subtle)] hover:text-[var(--rp-accent)]"
>
👍 {comment.likes}
</button>
{comment.replies.length > 0 && (
<ul className="ml-3 mt-1 space-y-1 border-l border-[var(--rp-border)] pl-2">
{comment.replies.map((reply, ri) => (
<li key={ri} className="text-[11px]">
<span className="font-medium">{reply.username}</span>
{reply.targetUser && (
<span className="ml-1 text-[var(--rp-accent)]">回复 @{reply.targetUser}</span>
)}
<span className="ml-1 text-[var(--rp-fg-subtle)]">
· {reply.time} · IP属地：{reply.location}
</span>
<p className="text-[var(--rp-fg)]">{reply.content}</p>
</li>
))}
</ul>
)}
</li>
))}
</ul>
</div>
</div>
)}
</li>
))}
</ul>
)}
</div>
</div>
<NovelTabBar route={route} onNavigate={onNavigate} />

{/* -------------------------------------------------------- reading view */}
{reading!== undefined && readingIndex!== null && (
<div role="dialog" aria-label={`阅读第 ${readingIndex + 1} 章`} className="fixed inset-0 z-50 flex flex-col bg-[var(--rp-bg)]">
<div className="flex shrink-0 items-center gap-1 border-b border-[var(--rp-border)] px-2 py-2">
<Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="关闭阅读" onClick={() => setReadingIndex(null)}>
<X className="size-4" aria-hidden="true" />
</Button>
<p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
第 {readingIndex + 1} 章 {reading.title || '未命名章节'}
</p>
<div className="flex shrink-0 items-center gap-0.5">
<Button
size="icon-sm"
variant="ghost"
className="rounded-full"
aria-label="减小字号"
disabled={fontSize <= 14}
onClick={() => setFontSize((s) => Math.max(14, s - 1))}
>
<Minus className="size-3.5" aria-hidden="true" />
</Button>
<span className="w-6 text-center text-[11px] tabular-nums text-[var(--rp-fg-muted)]">{fontSize}</span>
<Button
size="icon-sm"
variant="ghost"
className="rounded-full"
aria-label="增大字号"
disabled={fontSize >= 22}
onClick={() => setFontSize((s) => Math.min(22, s + 1))}
>
<Plus className="size-3.5" aria-hidden="true" />
</Button>
</div>
</div>
<div className="rp-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">
<div className="mx-auto max-w-2xl">
<h2 className="text-center text-[19px] font-bold leading-snug">{reading.title || '未命名章节'}</h2>
<p className="mt-1.5 text-center text-[11px] text-[var(--rp-fg-subtle)]">
第 {readingIndex + 1} 章 · {reading.wordCount} 字
</p>
{reading.content? (
<p className="mt-6 whitespace-pre-wrap" style={{ fontSize: `${fontSize}px`, lineHeight: 1.9}}>
{reading.content}
</p>
): (
<p className="mt-6 text-center text-[13px] text-[var(--rp-fg-muted)]">本章还是空的，点编辑开始写。</p>
)}
{reading.summary.trim() && (
<div className="mt-8 rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3">
<p className="text-[11px] font-semibold text-[var(--rp-fg-muted)]">本章摘要</p>
<p className="mt-1 text-[12.5px] leading-relaxed text-[var(--rp-fg-muted)]">{reading.summary}</p>
</div>
)}
</div>
</div>
<div className="flex shrink-0 gap-2 border-t border-[var(--rp-border)] px-3 py-2.5">
<Button
variant="outline"
className="flex-1 rounded-full"
disabled={readingIndex === 0}
onClick={() => setReadingIndex(readingIndex - 1)}
>
上一章
</Button>
<Button
variant="outline"
className="flex-1 rounded-full"
disabled={readingIndex >= book.chapters.length - 1}
onClick={() => setReadingIndex(readingIndex + 1)}
>
下一章
</Button>
</div>
</div>
)}
</div>
);
}
