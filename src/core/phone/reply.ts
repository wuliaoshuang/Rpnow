/**
 * 小手机的回复与生图提示词 — 纯函数，好测。
 *
 * 小手机是一套独立系统：微信里的聊天和主线角色扮演是两回事。
 * 回复只认角色本身是谁（名字、性格、介绍）和微信自己的聊天记录，
 * 不跟主线剧情走——场景、开场白、主线消息一律不进提示词。
 */
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage } from '@/core/llm/types.js';
import type { ImagePeople, PhoneContact, PhoneContactGender } from './types.js';

/**
 * 人数标签：生图提示词里的人数全靠这些标签定。
 *
 * 模型写提示词时靠不住（让它“只画一个人”，它照样能写出 2girls），
 * 所以不在提示词里求它，改由代码在模型返回之后、调生图接口之前直接改：
 * 先把提示词里所有人数标签删掉，再按这张图实际该有几个人加标记。
 * 模型改不掉这一步——就算它写了 2girls、写了 group，最后进生图接口的
 * 提示词里也只剩代码加的那一个人数标记。
 */
/** 单人标签：画面里只有一个人。 */
const SOLO_TAGS = new Set(['solo', '1girl', '1boy']);
/** 双人标签：画面里两个人。 */
const TWO_PERSON_TAGS = new Set([
  '2girls',
  '2boys',
  '2 girls',
  '2 boys',
  'couple',
  'two people',
]);
/** 多人标签：画面里三人以上。 */
const GROUP_TAGS = new Set([
  '3girls',
  '4girls',
  '3boys',
  '4boys',
  '3 girls',
  '4 girls',
  '3 boys',
  '4 boys',
  'multiple girls',
  'multiple boys',
  'multiple people',
  'group',
  'crowd',
  'three people',
  'several people',
  'harem',
  'multiple',
]);
/** 多人标签黑名单（双人＋多人）：单人强制时删掉这些。 */
const MULTI_PERSON_TAGS = new Set([...TWO_PERSON_TAGS, ...GROUP_TAGS]);

/** 按逗号切开提示词，去掉指定集合里的人数标签，剩下的原样保留。 */
function stripCountTags(prompt: string, strip: Set<string>): string[] {
  return prompt
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !strip.has(tag.toLowerCase()));
}

/**
 * 单人强制：把一条生图提示词改成“只有这一个角色”。
 *
 * 模型写出来的提示词不管长什么样，经过这里之后一定是单人：
 * 先把多人标签（2girls、group、multiple girls……）全部删掉，
 * 再在最前面加上单人标记（1girl, solo / 1boy, solo / solo）。
 * 这一步在模型返回之后、调生图接口之前由代码做，模型改不掉它——
 * 就算模型写了 2girls、写了 group，最后进生图接口的提示词里也没有。
 *
 * 只动人数标签和开头的单人标记，角色外貌和场景标签原样保留；
 * 提示词已经以 1girl / 1boy 开头时，不重复加性别标签，只补 solo。
 */
export function enforceSoloPrompt(prompt: string, gender: PhoneContactGender): string {
  const kept = stripCountTags(prompt, MULTI_PERSON_TAGS);
  const first = kept[0]?.toLowerCase();
  // 已经是单人开头：性别标签不重复加，solo 紧跟在它后面就行。
  if (first === '1girl' || first === '1boy') {
    if (kept[1]?.toLowerCase() === 'solo') return kept.join(', ');
    return [kept[0], 'solo', ...kept.slice(1)].join(', ');
  }
  // 已经以 solo 开头：女/男再补一个性别标签，未知性别直接用。
  if (first === 'solo') {
    if (gender === 'female') return ['1girl', ...kept].join(', ');
    if (gender === 'male') return ['1boy', ...kept].join(', ');
    return kept.join(', ');
  }
  const head =
    gender === 'female' ? ['1girl', 'solo'] : gender === 'male' ? ['1boy', 'solo'] : ['solo'];
  return [...head, ...kept].join(', ');
}

/**
 * 按人数强制：把一条生图提示词改成指定的人数（solo / duo / multi）。
 *
 * 图里有几个人不是写提示词的模型说了算——回复模型按场景在 send_image
 * 工具调用里给了 people，代码在这里按这个人数强制：先把提示词里所有
 * 人数标签（单人、双人、多人）都删掉，再在最前面加上对应的人数标记。
 *
 *   - solo：走 enforceSoloPrompt——删多人标签，加 1girl, solo / 1boy, solo / solo。
 *   - duo：双人标记。用户性别没存下来，标记按角色性别取对应的 Danbooru
 *     计数标签（女 2girls / 男 2boys / 未知按 2girls）；用户实际长相由
 *     写提示词的模型按对话写，不在这里硬编。
 *   - multi：多人标记（女 multiple girls / 男 multiple boys / 未知 group）。
 *
 * 外貌和场景标签原样保留，只动人数。
 */
export function enforceComposition(
  prompt: string,
  people: ImagePeople,
  gender: PhoneContactGender,
): string {
  if (people === 'solo') return enforceSoloPrompt(prompt, gender);
  const allCountTags = new Set([...SOLO_TAGS, ...TWO_PERSON_TAGS, ...GROUP_TAGS]);
  const kept = stripCountTags(prompt, allCountTags);
  if (people === 'duo') {
    const marker = gender === 'male' ? '2boys' : '2girls';
    return [marker, ...kept].join(', ');
  }
  const marker =
    gender === 'female' ? 'multiple girls' : gender === 'male' ? 'multiple boys' : 'group';
  return [marker, ...kept].join(', ');
}

/**
 * “＋”按钮里用户手写想画的内容：没有回复模型给 people，就按这句话
 * 简单判断——明确提到用户也在画面里（咱俩、合影、和我……）就是双人，
 * 提到一群人（我们仨、我们几个……）就是多人，否则默认单人（角色自己
 * 的照片）。只是个启发式，复杂情况以工具调用里模型给的 people 为准。
 */
const MULTI_KEYWORDS = ['我们仨', '我们几个', '一群人', '大家一起', '三个人', '多人'];
const DUO_KEYWORDS = ['咱俩', '咱两', '我俩', '合影', '合照', '双人', '和我', '一起拍'];
export function inferPeopleFromRequest(request: string): ImagePeople {
  const text = request.trim();
  if (MULTI_KEYWORDS.some((k) => text.includes(k))) return 'multi';
  if (DUO_KEYWORDS.some((k) => text.includes(k))) return 'duo';
  return 'solo';
}

/**
 * 独立系统的声明：微信聊天不是主线剧情的延续。
 * 回复提示词和生图提示词都用同一句话定调，免得模型把主线剧情接进来。
 */
const INDEPENDENCE =
  '这是一次独立的微信聊天，和主线角色扮演聊天没有关系，不是主线聊天的延续。' +
  '不要继续主线剧情，不要提及主线里正在发生的剧情、场景、事件或对话内容；' +
  '就当作平时在微信上和对方闲聊。';

/** 先想一想再回：想清楚自己是谁、和对方的关系、之前聊了什么。 */
const THINK_FIRST =
  '先想一想：你是谁，你的性格怎么样，你和对方是什么关系，这次微信聊天之前聊了什么；想清楚了再回复。';

/** 不 OOC：全程在角色里，不提 AI，不写 RP 式动作描写。 */
const NO_OOC =
  '全程保持角色身份，绝不跳出角色（不要 OOC），绝不提自己是 AI、模型或程序；' +
  '不用 *动作描写*，不要写长段角色扮演。';

/** 微信口吻：短句，1–3 句。 */
const SHORT_STYLE = '像在微信上发消息：1–3 句短句，口语化、亲切。';

/**
 * 工具：发图和发表情包——Agent 不是光会打字。
 *
 * 像真人一样自然地用：用户让你发图、发照片、看看你，或者你自己提到
 * 拍了照片、想分享一张图的时候，就调用发图工具发一张真的图，不要只在
 * 文字里说“我拍了照片”却不发图；想表达情绪的时候就发表情包，不要光
 * 靠文字。文字和工具可以一起用：先回一句文字，再发图或表情包。
 * 调用不了工具时，改在文字里写标记（`[发图：…]` / `[表情：…]`），
 * 我会帮你发出去，标记不会显示给用户看。
 */
const TOOLS =
  '你有两个工具可以用：发图（send_image）和发表情包（send_sticker）。' +
  '像真人一样自然地用它们：用户让你发图、发照片、看看你，或者你自己提到拍了照片、想分享一张图的时候，就调用发图工具发一张真的图，不要只在文字里说“我拍了照片”却不发图；' +
  '发图的时候想一想：这张图里有几个人——你一个人、你和用户两个人、还是一群人？按现在的场景填好发图工具的 people 参数（solo / duo / multi），不要默认只画你一个人；' +
  '想表达情绪的时候就发表情包，不要光靠文字。文字和工具可以一起用：先回一句文字，再发图或表情包。' +
  '如果你调用不了工具，就在文字里用标记写出来：[发图：这张图的内容]、[表情：开心/难过/害羞/惊讶/亲昵/生气]，我会帮你发出去，标记不会显示给用户看。';

/**
 * 回复用的 system prompt。
 *
 * 第一句就把 role play 的架子定死：我们现在在进行角色扮演，你要扮演
 * 这个角色，正在一个叫微信的地方和用户聊天——角色的设定（名字、性格、
 * 介绍）和联系人的关系都留在这里，模型按这个身份回。
 * 场景、开场白一律不进——那是主线剧情的东西，微信里不认。
 * 联系人的第一条消息也不写进这里：它本来就在微信聊天记录里。
 */
export function buildReplySystemPrompt(card: RPCard, contact: PhoneContact): string {
  const d = card.data;
  const framing = contact.isMain
    ? `我们现在在进行 role play（角色扮演）。你要扮演「${d.name}」，正在一个叫微信的地方，和用户聊天。`
    : `我们现在在进行 role play（角色扮演）。你要扮演「${contact.name}」，是「${d.name}」的${contact.relation}，正在一个叫微信的地方，和用户聊天。`;
  const identity = contact.isMain
    ? [
        `你是「${d.name}」，正在微信上和用户聊天。`,
        d.description ? `角色介绍：${d.description}` : '',
        d.personality ? `性格：${d.personality}` : '',
      ]
    : [
        `你是「${contact.name}」，是「${d.name}」的${contact.relation}，正在微信上和用户聊天。`,
        d.description ? `角色卡介绍：${d.description}` : '',
      ];
  return [framing, ...identity, INDEPENDENCE, THINK_FIRST, NO_OOC, SHORT_STYLE, TOOLS]
    .filter(Boolean)
    .join('\n');
}

/**
 * 生图提示词用的消息：让模型先从卡里提炼角色的外貌特征，
 * 再结合最近的微信聊天记录和用户想画的内容，写一条详细的生图提示词。
 *
 * 只输出提示词本身（不要 JSON、不要解释），调用方直接拿去调生图工具。
 *
 * 场景一定要从聊天记录里来：模型要先读最近的对话，弄清楚角色现在在哪
 * 里、在做什么、周围有什么、光线和气氛怎么样，再把这个角色放进这个场景
 * 里画出来——要的是一张有场景的图，不是白底人像。聊天记录传进来之前，
 * 图片和表情包已经换成了占位文字（`[对方发来一张图片]` / `[表情]`）。
 *
 * 人数由回复模型按场景在 send_image 工具调用里定（people）：
 * solo 是角色一个人，duo 是角色和用户两个人，multi 是三人以上。
 * 模型要按这个人数写提示词，画面里每个人的外貌都要写出来——角色按卡
 * 写；用户长什么样聊天记录里没写，不要凭空编一个精致长相，就写他/她是
 * 和角色在一起的那个人；其他人按传进来的联系人（名字、关系）和聊天记录
 * 里提到的样子写，不要编场景里没有的人。最后的人数由调用方用代码强制，
 * 这里只管把每个人的样子写对。
 */
export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ImagePromptOptions {
  /** 这张图里有几个人（回复模型按场景定的；不给默认 solo）。 */
  people?: ImagePeople;
  /** 图里可能出现的其他联系人（名字、关系；只在 duo/multi 时用）。 */
  others?: PhoneContact[];
}

/** 人数不同，画面里每个人的外貌怎么写。 */
const PEOPLE_COMPOSITION: Record<ImagePeople, string> = {
  solo: '人数：solo——画面里只有这个角色一个人，不要画其他人（不要画用户、不要画其他人、不要画路人）。',
  duo:
    '人数：duo——画面里是这个角色和用户两个人。' +
    '角色的外貌按角色卡写；另一个人是用户——聊天记录里没写用户长什么样，不要凭空编一个精致长相，就写他/她是和角色在一起的那个人，重点是两个人一起在做这件事（比如并肩自拍、一起走路）。',
  multi:
    '人数：multi——画面里是这个角色、用户和其他人（三人以上）。' +
    '角色的外貌按角色卡写；用户是和角色在一起的那个人（聊天记录里没写用户长什么样，不要凭空编精致长相）；' +
    '其他人按下面列出的人和聊天记录里提到的样子写，没提到的就写成和角色在一起的人；不要编场景里没有的人。',
};

export function buildImagePromptMessages(
  card: RPCard,
  contact: PhoneContact,
  userRequest: string,
  recentMessages: ChatHistoryEntry[],
  options: ImagePromptOptions = {},
): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个生图提示词助手。只返回提示词本身，不要解释、不要加多余文字、不要用 JSON、不要加代码块。',
    },
    {
      role: 'user',
      content: [
        '请为下面这个角色写一条生图提示词：',
        buildImageTagContext(card, contact, userRequest, recentMessages, options),
        '要求：先读最近的微信聊天记录，弄清楚现在的场景：角色现在在哪里、在做什么、周围有什么、光线和气氛怎么样（比如老街、法桐树下、买凉皮、九月的阳光从树叶缝隙漏下来）；再从角色介绍和性格里提炼出这个角色的外貌特征（头发、眼睛、穿着、标志性特点），让画出来的人一眼就能认出是这个角色；用户和其他人按上面“人数”里说的办法写，不要编场景里没有的人；最后按上面定的人数，把这些人放进这个场景里、正在做这件事，写成一条详细的英文生图提示词（Danbooru 风格标签，逗号分隔，写在一行里）。要的是一张有场景的图，不是白底人像——场景从聊天记录里来，不要只按用户那句短话画，更不要只画一张人像。只输出这条提示词本身，不要解释。',
      ].join('\n'),
    },
  ];
}

/**
 * 生图要转写 Tag 用的上下文（正文）：场景＋人物外貌的自然语言描述。
 *
 * 和 buildImagePromptMessages 共用同一份内容：角色的外貌（卡里的介绍和
 * 性格）、人数（回复模型按场景定的 solo / duo / multi，画面里每个人怎
 * 么写）、最近的微信聊天记录（场景从这里来）、用户想画的内容。
 * 区别是这里不带“写一条生图提示词”的开头和“要求”那段指令——它就是要
 * 拿去转写的画面描述，交给 Tag 转写（设置 → 生图 → Tag 转写）转成
 * Danbooru Tag，再填进正面提示词。转写失败时调用方退回
 * buildImagePromptMessages，让模型直接写提示词。
 */
export function buildImageTagContext(
  card: RPCard,
  contact: PhoneContact,
  userRequest: string,
  recentMessages: ChatHistoryEntry[],
  options: ImagePromptOptions = {},
): string {
  const d = card.data;
  const people = options.people ?? 'solo';
  const appearance = [
    `角色名：${contact.name}`,
    contact.isMain ? '' : `和主角「${d.name}」的关系：${contact.relation}`,
    d.description ? `角色介绍：${d.description}` : '',
    d.personality ? `性格：${d.personality}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const others = (options.others ?? []).filter((o) => o.id !== contact.id);
  const composition = [
    PEOPLE_COMPOSITION[people],
    // 其他人只在 multi 时列出来：duo 是角色和用户两个人，其他联系人不在画面里。
    people === 'multi' && others.length > 0
      ? [
          '图里可能出现的其他人（只画聊天记录里提到的）：',
          ...others.map((o) => `- ${o.name}（${o.relation}）`),
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const conversation =
    recentMessages.length > 0
      ? [
          '最近的微信聊天记录（按时间顺序，场景就从这里来）：',
          ...recentMessages.map(
            (m) => `${m.role === 'assistant' ? contact.name : '用户'}：${m.content}`,
          ),
        ].join('\n')
      : '';
  return [
    appearance,
    composition,
    conversation,
    `用户想画的内容：${userRequest}`,
  ]
    .filter(Boolean)
    .join('\n');
}
