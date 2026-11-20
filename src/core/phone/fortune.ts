/**
* 运势占卜 / 塔罗（Fortune）— 纯函数，好测。
*
* 搬的是“小手机”插件 fortune.html 那套逻辑，用 Rpnow 的办法重新写了一遍
* （没抄插件的代码）：
*
* - 运势占卜：挑一个类别（事业 / 爱情 / 财运 / 健康），调一次模型，
* 按占星师的口吻给标题、一段 100–150 字的解读、幸运色、1–9 的幸运
* 数字和一句口头禅；模型失败或回空时，用每类写好的静态解读兜底，
* 不再调第二次模型。
* - 塔罗：从写死的 22 张大阿卡纳里随机抽一张，50% 逆位，再调一次模型
* 写约 100 字的解读；模型失败或回空时，用这张牌写好的静态牌义兜底。
* - 插件里“运势影响财运模拟器”那条线没搬：Rpnow 没有财富/股票模块。
* - 存取在 fortuneStore.ts：按聊天存，只留最新一次运势和最新一次塔罗；
* 不写世界书、不花钱、不动好感度。
*/
import type { LLMMessage} from '@/core/llm/types.js';
import type { FortuneCategoryId, HoroscopeResult, TarotDraw} from './types.js';

/** 四个运势类别（按这个顺序排按钮）。 */
export const FORTUNE_CATEGORIES: Array<{ id: FortuneCategoryId; label: string}> = [
{ id: 'career', label: '事业'},
{ id: 'love', label: '爱情'},
{ id: 'wealth', label: '财运'},
{ id: 'health', label: '健康'},
];

/** 类别 id → 中文名，没有返回 '运势'。 */
export function fortuneCategoryLabel(id: FortuneCategoryId): string {
return FORTUNE_CATEGORIES.find((c) => c.id === id)?.label?? '运势';
}

/** 22 张大阿卡纳（按标准顺序）。 */
export const TAROT_DECK: string[] = [
'愚者', '魔术师', '女祭司', '女皇', '皇帝', '教皇', '恋人', '战车',
'力量', '隐者', '命运之轮', '正义', '倒吊人', '死神', '节制', '恶魔',
'塔', '星星', '月亮', '太阳', '审判', '世界',
];

/**
* 抽一张塔罗牌：牌从 22 张里随机抽，50% 逆位。
* rng 可注入（默认 Math.random），测试里传固定函数就能抽到确定的牌。
*/
export function drawTarotCard(rng: () => number = Math.random): {
cardName: string;
reversed: boolean;
} {
const cardName = TAROT_DECK[Math.floor(rng() * TAROT_DECK.length)]?? TAROT_DECK[0];
return { cardName, reversed: rng() < 0.5};
}

/** 逆位 / 正位的显示词。 */
export function tarotOrientation(reversed: boolean): string {
return reversed? '逆位': '正位';
}

// ---------- 运势占卜 ----------

/** 运势占卜那次模型调用的标签。 */
const HOROSCOPE_LABELS = ['标题', '解读', '幸运色', '幸运数字', '口头禅'] as const;

/** 和 moments.ts 里 extractLabel 同款：从标签文本里按标签取值。 */
function extractLabel(text: string, label: string, labels: readonly string[]): string {
const others = labels.filter((l) => l!== label).join('|');
const re = new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${others})\\s*[:：]|$)`, 'i');
const m = text.match(re);
return m? m[1].trim(): '';
}

/**
* 运势占卜的提示词（一次模型调用，只在用户点了“占卜”之后）。
* 让模型以占星师的口吻，按标签格式回：标题、100–150 字的解读、幸运色、
* 1–9 的幸运数字、一句口头禅。
*/
export function buildHoroscopeMessages(category: FortuneCategoryId): LLMMessage[] {
const label = fortuneCategoryLabel(category);
return [
{
role: 'user',
content: [
`你是一位温和、真诚的占星师。请为我占卜今天的${label}运势。`,
'按以下格式输出（每个标签单独一行，标签后用中文冒号）：',
'标题：一句吸引人的运势标题',
`解读：一段 100–150 字的${label}运势解读，写得具体、温暖、可执行，不要空话套话`,
'幸运色：一个颜色',
'幸运数字：1–9 之间的一个数字',
'口头禅：一句今天可以默念的话',
'',
'格式铁律：每个标签单独一行，直接输出上述格式，不要说任何多余的话。',
].join('\n'),
},
];
}

/** 解析模型回的运势文本：解读取不到时返回 null（调用方用静态兜底）。 */
export function parseHoroscopeText(
text: string,
category: FortuneCategoryId,
): HoroscopeResult | null {
const body = String(text || '').trim();
if (!body) return null;
const reading = extractLabel(body, '解读', HOROSCOPE_LABELS);
if (!reading) return null;
const num = parseInt(extractLabel(body, '幸运数字', HOROSCOPE_LABELS), 10);
const luckyNumber = Number.isFinite(num) && num >= 1 && num <= 9? num: 1 + (Date.now() % 9);
return {
category,
title: extractLabel(body, '标题', HOROSCOPE_LABELS) || `${fortuneCategoryLabel(category)}运势`,
reading,
luckyColor: extractLabel(body, '幸运色', HOROSCOPE_LABELS) || '白色',
luckyNumber,
mantra: extractLabel(body, '口头禅', HOROSCOPE_LABELS) || '',
timestamp: Date.now(),
};
}

/** 每类运势的静态兜底解读（模型失败或回空时用，不再调模型）。 */
export const HOROSCOPE_FALLBACKS: Record<
FortuneCategoryId,
Array<{ title: string; reading: string; luckyColor: string; luckyNumber: number; mantra: string}>
> = {
career: [
{
title: '稳步向前的日子',
reading: '今天适合把手头的事一件件做完，不用急着求快。上午的思路最清楚，难啃的任务可以先啃一口；下午多和同事通个气，你以为的麻烦，别人一句话就能点破。别把小事拖到明天，今天收个尾，明天会轻松很多。',
luckyColor: '深蓝色',
luckyNumber: 3,
mantra: '先做完，再做好。',
},
{
title: '灵感在路上的日子',
reading: '今天脑子转得比平时快，适合想点子、写方案、做规划。别怕想法还不成熟，先记下来，傍晚回头看会有惊喜。开会时多听少说，你会听到一句对你很有用的话。',
luckyColor: '薄荷绿',
luckyNumber: 7,
mantra: '好点子先记下来。',
},
{
title: '适合收尾的日子',
reading: '今天适合收尾：把拖着的邮件回了、把半成品推进一步，收尾的成就感会推着你往前走。遇到卡住的地方，换个顺序做，别硬顶，绕过去反而更快。',
luckyColor: '米白色',
luckyNumber: 5,
mantra: '收个尾，轻装上阵。',
},
],
love: [
{
title: '心意会传到的日子',
reading: '今天适合把心里的话说出口，不用铺垫太多，真诚本身就够动人。单身的话，多留意那个总在你附近出现的人；有伴的话，今晚一起吃顿好的，什么都不聊也挺好。',
luckyColor: '粉色',
luckyNumber: 2,
mantra: '真诚一点点就好。',
},
{
title: '适合靠近的日子',
reading: '今天的气氛很适合靠近：发一条消息、约一次散步，小小的举动都会被认真对待。别猜对方在想什么，直接问一句，比猜一下午管用。',
luckyColor: '珊瑚红',
luckyNumber: 6,
mantra: '问一句，比猜一下午强。',
},
{
title: '慢慢来的日子',
reading: '感情今天不用赶进度，慢慢来反而更稳。对方的一句随口的话可能藏着在意你的意思，留意一下。晚上留点时间给自己，状态好了，缘分才看得见你。',
luckyColor: '淡紫色',
luckyNumber: 4,
mantra: '慢慢来，比较快。',
},
],
wealth: [
{
title: '守住钱包的日子',
reading: '今天财运平平，适合守成不适合冲动。看到打折先别急着下单，睡一觉再决定，大概率会发现没那么想要。月底对账时，你会感谢今天克制的自己。',
luckyColor: '金色',
luckyNumber: 8,
mantra: '睡一觉再买。',
},
{
title: '小财在路上的日子',
reading: '今天有小小的好运气：可能是退回的一笔钱、一个小优惠，或者一个一直想买的东西刚好降价。别贪大，小确幸攒起来也是财运。',
luckyColor: '墨绿色',
luckyNumber: 1,
mantra: '小确幸也是财运。',
},
{
title: '适合盘点日子',
reading: '今天适合盘点一下自己的钱：看看订阅里有没有早该取消的，看看账单里有没有重复扣的。省下来的，就是今天赚到的。',
luckyColor: '银灰色',
luckyNumber: 9,
mantra: '省下来的就是赚到的。',
},
],
health: [
{
title: '身体想被照顾的日子',
reading: '今天身体在提醒你慢一点：多喝水，少熬夜，脖子肩膀动一动。下午抽二十分钟出去走走，晒晒太阳，回来会发现脑子清醒不少。健康是今天的正事。',
luckyColor: '草绿色',
luckyNumber: 3,
mantra: '出去走走，晒晒太阳。',
},
{
title: '早点睡的日子',
reading: '今天没什么比睡个好觉更重要。睡前一小时放下手机，泡个脚或者听点轻音乐，明天早上你会明显感觉到差别。身体攒的疲惫，睡眠是最好的还法。',
luckyColor: '天蓝色',
luckyNumber: 5,
mantra: '今晚早点睡。',
},
{
title: '动起来的日子',
reading: '今天适合动一动：不用练得多狠，拉伸、散步、爬楼梯都算数。动完出点汗，心情会跟着松下来，晚上也更容易睡着。',
luckyColor: '橙色',
luckyNumber: 7,
mantra: '动一动，心情会松下来。',
},
],
};

/**
* 取一条静态兜底运势：按类别从池子里挑一条。
* pick 可注入（默认随机挑）；测试里传固定函数就能拿到确定的那条。
*/
export function fallbackHoroscope(
category: FortuneCategoryId,
pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): HoroscopeResult {
const pool = HOROSCOPE_FALLBACKS[category];
const item = pool[pick(pool.length)]?? pool[0];
return { category,...item, timestamp: Date.now()};
}

// ---------- 塔罗 ----------

/** 每张大阿卡纳的静态牌义（正位 / 逆位各一句，模型失败时兜底用）。 */
export const TAROT_MEANINGS: Record<string, { upright: string; reversed: string}> = {
'愚者': { upright: '新的开始，带着勇气出发吧。未知不是危险，是还没展开的礼物。', reversed: '先别急着出发，看看脚下有没有没准备好的地方。冲动之前，先停一停。'},
'魔术师': { upright: '你手里已经有全部的牌了，别等万事俱备，现在就能开始。', reversed: '别被花里胡哨的东西分心，回到最核心的那件事上。'},
'女祭司': { upright: '答案在你心里，只是你还没安静下来听。直觉今天很准。', reversed: '别忽略心里那个小小的声音，它已经提醒你好几次了。'},
'女皇': { upright: '丰盛和滋养的一天，对自己好一点，也对身边的人温柔一点。', reversed: '先照顾好自己，再照顾别人——你已经透支一阵子了。'},
'皇帝': { upright: '拿出秩序和决断来，今天需要你做主。规则立好了，事情就顺了。', reversed: '别太较劲，控制欲松一松，反而能看到更好的办法。'},
'教皇': { upright: '传统和经验今天是你的帮手，问问过来人，少走弯路。', reversed: '规矩是参考，不是枷锁——这件事可以按你的方式来。'},
'恋人': { upright: '一个需要用心选择的日子，跟着心里真正想要的走。', reversed: '别为了讨好别人做决定，先问问自己到底想要什么。'},
'战车': { upright: '方向对了就别停，今天适合全力冲一把，胜利在前面。', reversed: '方向有点乱，先停下来对一对目标，再踩油门。'},
'力量': { upright: '温柔比强硬更有力量，耐心一点，你能驯服眼前的难题。', reversed: '别硬撑，承认累了不是认输，休息好了再上。'},
'隐者': { upright: '独处一下吧，安静里藏着你找了很久的答案。', reversed: '想明白了就走出来，别一个人在原地打转。'},
'命运之轮': { upright: '运气正在转弯，好事可能在你没留意的地方发生。', reversed: '低谷是轮子的一部分，别急着翻盘，先稳住。'},
'正义': { upright: '公平会站在你这边，讲清楚道理，事情会有公道的结果。', reversed: '先别急着评判，事情可能还有你不知道的另一面。'},
'倒吊人': { upright: '换个角度看问题，卡住的事可能一下就通了。', reversed: '别再原地等了，动一动，哪怕只是换个小做法。'},
'死神': { upright: '一个旧阶段结束了，腾出地方，好东西才能进来。', reversed: '放不下的，正在拖住你——松手不是失去，是腾地方。'},
'节制': { upright: '平衡就是答案，别走极端，慢慢调，心态就稳了。', reversed: '最近有点失衡了，先把作息和节奏找回来。'},
'恶魔': { upright: '看看是什么在绑着你——认清它，你就已经松开一半了。', reversed: '你正在挣脱一个旧习惯，别回头，继续走。'},
'塔': { upright: '突如其来的变化在拆旧东西，别怕，拆掉的都是该拆的。', reversed: '一场小震动过去了，收拾收拾，基础还在。'},
'星星': { upright: '希望回来了，今晚抬头看看天，好运正在路上。', reversed: '希望还在，只是被云挡住了——再坚持一下。'},
'月亮': { upright: '有些事还看不清楚，别急着下结论，等雾散了再说。', reversed: '雾快散了，真相正在浮现，你的担心多半是多余的。'},
'太阳': { upright: '阳光灿烂的一天，适合出门、适合开心、适合把好消息分享出去。', reversed: '阳光在云后面，今天的小确幸需要你主动去找一找。'},
'审判': { upright: '一个重新开始的机会，过去的就让它过去，轻装上阵。', reversed: '别总翻旧账，给自己一次重新来过的机会。'},
'世界': { upright: '一个圆满的句号，你走到头了，也走到新的起点。', reversed: '只差最后一步了，别在终点前松劲。'},
};

/**
* 塔罗抽牌的提示词（一次模型调用，只在用户点了“抽牌”之后）。
* 牌和正逆位已经抽好了（drawTarotCard），模型只负责写约 100 字的解读。
*/
export function buildTarotMessages(cardName: string, reversed: boolean): LLMMessage[] {
return [
{
role: 'user',
content: [
`你是一位温和、真诚的塔罗占卜师。我今天抽到了一张塔罗牌：${cardName}（${tarotOrientation(reversed)}）。`,
'请为我解读这张牌：写一段约 100 字的解读，结合这张牌的牌义和正逆位，说说它对今天的提示，写得具体、温暖、可执行，不要空话套话。',
'直接输出解读正文，不要说任何多余的话。',
].join('\n'),
},
];
}

/** 解析模型回的塔罗解读：空的返回 ''（调用方用静态牌义兜底）。 */
export function parseTarotText(text: string): string {
return String(text || '').trim();
}

/** 静态塔罗兜底：这张牌、这个正逆位的牌义，拼成一条解读。 */
export function fallbackTarot(cardName: string, reversed: boolean): string {
const meaning = TAROT_MEANINGS[cardName];
if (!meaning) return '这张牌想告诉你：慢一点，听听自己的心。';
return reversed? meaning.reversed: meaning.upright;
}

/** 建一次塔罗抽牌的结果（id 不用，时间在这里定）。 */
export function buildTarotDraw(
cardName: string,
reversed: boolean,
reading: string,
): TarotDraw {
return { cardName, reversed, reading, timestamp: Date.now()};
}

// ---------- 复制用的文本 ----------

/** 运势结果复制成文本：标题 + 解读 + 幸运色 / 幸运数字 / 口头禅。 */
export function formatHoroscopeCopyText(result: HoroscopeResult): string {
const lines = [
`「${fortuneCategoryLabel(result.category)}运势」${result.title}`,
result.reading,
`幸运色：${result.luckyColor}`,
`幸运数字：${result.luckyNumber}`,
];
if (result.mantra.trim()) lines.push(`口头禅：${result.mantra}`);
return lines.join('\n');
}

/** 塔罗结果复制成文本：牌名（正/逆位）+ 解读。 */
export function formatTarotCopyText(draw: TarotDraw): string {
return `「塔罗」${draw.cardName}（${tarotOrientation(draw.reversed)}）\n${draw.reading}`;
}
