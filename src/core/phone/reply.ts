/**
 * 小手机的回复与生图提示词 — 纯函数，好测。
 *
 * 小手机是一套独立系统：微信里的聊天和主线角色扮演是两回事。
 * 回复只认角色本身是谁（名字、性格、介绍）和微信自己的聊天记录，
 * 不跟主线剧情走——微信是单独的聊天，不续写主线。
 * 但它共享主聊天的素材：卡的设定（scenario）、世界书（按主聊天同一套
 * activate() 选出来的条目）、卡的开场白（只当说话方式的参考，不当
 * 微信第一条消息）、主线聊天的最近进展（剧情进度，只做了解），以及
 * 主聊天所用预设里的提示词（按最高注入深度放在最后、紧贴聊天记录）。
 * 只有一样例外：微信的第一条消息还是模型按剧情写的短消息，不用卡的
 * first_mes 原文（PR #32/#33 的规矩还在）。
 */
import type { RPCard } from '@/core/types/card.js';
import type { RPChatMessage } from '@/core/types/chat.js';
import type { LLMMessage } from '@/core/llm/types.js';
import { displayRelation } from './contacts.js';
import {
  AFFECTION_DATE_UNLOCK,
  AFFECTION_MAX,
  AFFECTION_PRIVATE_PHOTO_UNLOCK,
  affectionOf,
} from './contacts.js';
import type { ImagePeople, PhoneContact, PhoneContactGender } from './types.js';

/**
 * 联系人和 User、主角的关系怎么写进提示词：relation 是和 User 的关系，
 * relationToMain 是和主角的关系。返回“是……”那半句，直接接在
 * “你要扮演「X」”后面：
 *
 *   - 和 User 的关系写了：是用户的闺蜜；和主角的关系也写了、还不一样，
 *     再补一句“也是「李淑纯」的闺蜜”，模型两头的关系都清楚；
 *   - 只写了和 User 的关系：是用户的闺蜜；
 *   - 只写了和主角的关系：是「李淑纯」的闺蜜（和 User 的关系卡里没写，
 *     提示词里另有一句“不要自己编”，见 buildReplySystemPrompt）；
 *   - 两边都没写：空字符串，提示词里不写关系这一句。
 */
export function relationClause(contact: PhoneContact, charName: string): string {
  const toUser = contact.relation.trim();
  const toMain = contact.relationToMain?.trim() ?? '';
  if (toUser) {
    if (toMain && toMain !== toUser) return `是用户的${toUser}，也是「${charName}」的${toMain}`;
    return `是用户的${toUser}`;
  }
  if (toMain) return `是「${charName}」的${toMain}`;
  return '';
}

/**
 * 好感度这一节：把当前好感度写进提示词，模型按亲密度回。
 *
 * 数字是“当前好感度：75/100”这样一行；后面跟一句按档位写的提示，
 * 让模型知道这个数是什么意思：还没到约会线（50）时客气克制一点，
 * 到了 50 关系不错、可以亲近主动，到了 80（私密照线）关系非常亲密、
 * 可以很亲昵、愿意分享私事。模型不改这个数——数是聊天里一条一条
 * 消息涨上去的（用户发消息 +1，角色回一次 +1），提示词里只告诉它。
 */
export function affectionSectionContent(contact: PhoneContact): string {
  const value = affectionOf(contact);
  const cue =
    value >= AFFECTION_PRIVATE_PHOTO_UNLOCK
      ? '你们关系非常亲密，可以很亲昵、很主动，愿意分享自己的私事。'
      : value >= AFFECTION_DATE_UNLOCK
        ? '你们关系不错，可以更亲近、更主动一点。'
        : '你们还不太熟，说话客气一点、保持一点距离。';
  return `当前好感度：${value}/${AFFECTION_MAX}。好感度越高，你们的关系越亲密。${cue}`;
}

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
 * 图里有几个人不是写提示词的模型说了算——调用方按发图的描述判断
 * 了 people（`inferPeopleFromRequest`），代码在这里按这个人数强制：
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
 * 用户手写、或回复模型在 `{image:…}` 标记里写下的想画的内容：按这句
 * 话简单判断——明确提到用户也在画面里（咱俩、合影、和我……）就是双人，
 * 提到一群人（我们仨、我们几个……）就是多人，否则默认单人（角色自己
 * 的照片）。只是个启发式。
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
 * 用户这句话是不是在要图：只有明确要图才算——发图、发照片、看看你、
 * 自拍、拍一张、合影……模型自己想发图不算数。调用方拿这个守门：
 * 用户这句没要图，模型在回复里写 `{image:…}` 也白搭，不生图、不调生图接口。
 *
 * 只认带“发/拍/看/给”这类动词的要图说法，单独一个“图”字不算
 * （比如“这张图真好看”只是在聊图，不是让发图）。
 */
const IMAGE_REQUEST_PHRASES = [
  '发图',
  '发张图',
  '发个图',
  '发照片',
  '发张照片',
  '发个照片',
  '发自拍',
  '发个自拍',
  '发张自拍',
  '看看你',
  '看一下你',
  '让我看看',
  '给我看看',
  '给我看一下',
  '自拍',
  '拍一张',
  '拍照',
  '拍个照',
  '拍张照',
  '照相',
  '合影',
  '合张影',
  '合照',
  '来张图',
  '来张照片',
];
export function looksLikeImageRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return IMAGE_REQUEST_PHRASES.some((phrase) => t.includes(phrase));
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
 * 主线剧情进度：把主线聊天（手机外面那个正常聊天）的最近消息压成一小段。
 *
 * 只给角色“知道剧情到了哪一步”用——比如现在是报到日、角色在 3 栋、
 * 用户在 4 栋，别在微信里说出和主线矛盾的话。不是让它续写主线。
 *
 * 只要最近 10 条：系统消息、隐藏消息、开场白（问候）和空消息都不要；
 * 每条超过 200 字就截断（多余的用“…”代替），免得提示词被撑爆；
 * 谁说的写清楚：用户还是这个角色。主线还没聊起来（空的、或者只有
 * 开场白）就返回空字符串，调用方不往提示词里加这一节。
 */
const PLOT_PROGRESS_MAX_MESSAGES = 10;
const PLOT_PROGRESS_MAX_CHARS = 200;

export function formatPlotProgress(messages: RPChatMessage[], characterName: string): string {
  const usable = messages.filter(
    (m) => m.role !== 'system' && !m.hidden && !m.isGreeting && m.content.trim().length > 0,
  );
  const recent = usable.slice(-PLOT_PROGRESS_MAX_MESSAGES);
  if (recent.length === 0) return '';
  return recent
    .map((m) => {
      const who = m.role === 'assistant' ? characterName : '用户';
      const chars = [...m.content.trim()];
      const content =
        chars.length > PLOT_PROGRESS_MAX_CHARS
          ? `${chars.slice(0, PLOT_PROGRESS_MAX_CHARS).join('')}…`
          : chars.join('');
      return `${who}：${content}`;
    })
    .join('\n');
}

/**
 * 剧情进度这一节的标题：只给“知道剧情到了哪一步”用，不续写主线，
 * 也不把主线里正在发生的事当成微信里正在聊的事。
 */
const PLOT_PROGRESS_HEADER =
  '以下是主线聊天的最近进展，仅供你了解当前剧情到了哪一步（比如角色现在在哪、在做什么）：';
const PLOT_PROGRESS_FOOTER =
  '不要直接续写主线剧情，也不要把主线里正在发生的事当成微信里正在聊的事。微信是你和用户单独的聊天。';

/**
 * 回复格式：标记写法——模型不是 Agent、不调工具，直接在回复文字里
 * 写 `{...}` 标记，调用方抠出来执行（插件那套做法）。
 *
 * 每条消息包在 `{chat:…}` 里（1–3 句短句）；只有用户明确让发图时
 * 才写 `{image:…}`，发图的内容里要写清楚场景和图里有几个人（调用方
 * 按描述里“和用户一起”“合影”这类词判断人数）；想表达情绪时可以
 * 主动写 `{sticker:情绪}`。标记不会显示给用户看。
 */
const FORMAT =
  '回复的格式：像在微信上发消息，1–3 句短句，每句包在 {chat:…} 里（比如 {chat:在吗}{chat:今天花店好忙}）。' +
  '想发图的时候——只有用户明确让你发图（比如用户说“发张图”“发照片”“看看你”）才发图，用户没让你发图时不要发图、不要自己主动发图；' +
  '要发图就写 {image:这张图的内容 ||| 英文标签}：内容里写清楚现在的场景（在哪里、在做什么、周围有什么），不要只写“我的照片”“自拍”这种没场景的话；' +
  '图里有几个人也要写明白：你一个人就只写你自己，和用户一起就写“和用户一起”或“合影”，一群人就写清楚还有谁；||| 后面是可选的英文 Danbooru 标签（比如 1girl, solo, street），没有就不写；' +
  '想表达情绪的时候可以主动发表情包：写 {sticker:情绪}，情绪只能是 happy、sad、shy、surprised、affectionate、angry 其中之一。' +
  '除了 chat、image、sticker 这三种标记，不要在回复里写别的花括号标记。';

/**
 * 回复用的 system prompt。
 *
 * 第一句就把 role play 的架子定死：我们现在在进行角色扮演，你要扮演
 * 这个联系人（卡里提到的其他人物，不是卡的主角本人），正在一个叫微信
 * 的地方和用户聊天——联系人自己的人设（profile：性格、长相、关键
 * 特点）写在【人设】一节，模型按这个身份回，不 OOC；卡的设定、世界书、
 * 开场白和主聊天的预设都按这个顺序排在后面。
 *
 * 关系按 User 来写：framing 和身份里写的是联系人和 User 的关系
 * （relation，比如“是用户的闺蜜”），和主角的关系（relationToMain）
 * 在后面当补充信息；和 User 的关系卡里没写时，只写和主角的关系、
 * 并写明不要自己编一个和 User 的关系——模型才不会把“主角的闺蜜”
 * 当成“用户的闺蜜”来对 User。
 *
 * 和主聊天共享的素材（按这个顺序排，越往后离聊天记录越近、越显眼）：
 *   【好感度】当前好感度（0–100）：模型按这个数决定亲密度——低时客气
 *     克制，高时亲近主动；数是聊天里涨上去的，不由模型改；
 *   【人设】联系人自己的人设——性格、长相、关键特点（初始化时按卡里 /
 *     世界书里写到的提炼的，没提到的不写这一节）；
 *   【设定】卡的 scenario——世界/场景设定（介绍和性格已经在身份那一段，
 *     这里不重复）；【世界书】按主聊天同一套 activate() 选出来的条目；
 *   【开场白】卡的 first_mes——只当说话方式和开场语气的参考，绝不当
 *     微信第一条消息（微信第一条还是模型按剧情写的短消息）；
 *   剧情进度（主线聊天的最近进展，只做了解、不续写主线）。
 * 最后是【预设】：主聊天所用预设里抽出来的提示词，按最高注入深度放
 * 在最后、紧贴聊天记录——模型下笔前最后看到的就是它。预设定的是角色
 * 扮演的规则与写法；回复的格式仍是微信短消息，不套用预设里主聊天的
 * 正文包裹格式（比如 <game> / <summary> / <options> 这类标签）。
 *
 * extras 全是可选的：没传的那一节整个不写，提示词不会出现空章节。
 * 联系人没有 profile 时，【人设】一节也不写（老缓存里没有这个字段）。
 */
export interface ReplyPromptExtras {
  /** 主线聊天的最近进展（formatPlotProgress 压出来的），只做了解。 */
  plotProgress?: string;
  /** 世界书文本（lorebook.ts 的 selectLorebookText 选出来的条目）。 */
  lorebookText?: string;
  /** 预设提示词文本（preset.ts 的 extractPresetPrompts 抽出来的）。 */
  presetText?: string;
  /**
   * 群聊注脚（groups.ts 的 buildGroupNote 拼的）：你在哪个群里、和谁
   * 一起聊、记忆归属。只在群聊回复里有；拼进“独立系统”那一节，不另
   * 起一节——提示词查看器还是 14 节。
   */
  groupNote?: string;
}

/** 开场白当参考时最多引用多少字（只取说话方式，不用整段）。 */
const FIRST_MES_CONTEXT_CHARS = 500;

/** 提示词构成的一节：label 是给查看器看的名字，content 为空 = 这一节没写进提示词。 */
export interface ReplyPromptSection {
  key: string;
  label: string;
  content: string;
}

/**
 * 回复 system prompt 的分节版：和 buildReplySystemPrompt 同一份拼装，
 * 查看器和小手机的回复共用它，所以查看器里看到的就是真正发出去的东西。
 * 顺序就是提示词里的顺序：角色扮演开场 → 身份 → 好感度 → 人设 → 设定 →
 * 世界书 → 开场白 → 剧情进度 → 独立系统 → 先想一想 → 不跳出角色 →
 * 短聊格式 → 回复格式 → 预设（最后 = 最高注入深度）。
 */
export function buildReplySystemPromptSections(
  card: RPCard,
  contact: PhoneContact,
  extras: ReplyPromptExtras = {},
): ReplyPromptSection[] {
  const d = card.data;
  // 联系人都是卡里提到的其他人物（卡的主角本人不是联系人），所以
  // framing 和身份一律按“扮演这个联系人”写；关系按 User 来写
  // （relation），和主角的关系（relationToMain）只当补充信息。
  const clause = relationClause(contact, d.name);
  const framing = `我们现在在进行 role play（角色扮演）。你要扮演「${contact.name}」${clause ? `，${clause}` : ''}，正在一个叫微信的地方，和用户聊天。`;
  // 和 User 的关系卡里没写时：只写了和主角的关系，提示词里明说不要
  // 自己编一个和 User 的关系——不然模型会把主角的关系套到 User 头上。
  const relationNote =
    !contact.relation.trim() && contact.relationToMain?.trim()
      ? `卡里没写${contact.name}和你是什么关系，不要自己编一个和你的关系。`
      : '';
  const identity = [
    `你是「${contact.name}」${clause ? `，${clause}` : ''}，正在微信上和用户聊天。`,
    relationNote,
    d.description ? `角色卡介绍：${d.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  // 好感度：总有（老缓存里没有这个字段按 0 算）——模型按这个数决定
  // 亲密度：低时客气克制，高时亲近主动；数本身由聊天涨，不由模型改。
  const affectionSection = affectionSectionContent(contact);
  // 联系人自己的人设：性格、长相、关键特点——模型扮演的就是这个人，
  // 人设写在这里它才不会 OOC；老缓存里没有 profile 时不写这一节。
  const profileSection = contact.profile?.trim()
    ? `【人设】\n${contact.name}的人设：${contact.profile.trim()}`
    : '';
  const settingsSection = d.scenario?.trim() ? `【设定】\n${d.scenario.trim()}` : '';
  const lorebookSection = extras.lorebookText?.trim()
    ? `【世界书】\n${extras.lorebookText.trim()}`
    : '';
  const firstMes = d.first_mes?.trim() ?? '';
  const firstMesSection = firstMes
    ? [
        '【开场白】',
        '角色卡的开场白，只供参考这个角色的说话方式和开场语气——不要把它当成微信的第一条消息，也不要照抄：',
        [...firstMes].length > FIRST_MES_CONTEXT_CHARS
          ? `${[...firstMes].slice(0, FIRST_MES_CONTEXT_CHARS).join('')}…`
          : firstMes,
      ].join('\n')
    : '';
  const plotSection = extras.plotProgress
    ? [PLOT_PROGRESS_HEADER, extras.plotProgress, PLOT_PROGRESS_FOOTER].join('\n')
    : '';
  // 群聊注脚拼进“独立系统”那一节：它说的就是“这次聊天是哪种聊天”，
  // 和独立系统同一节最合适；不另起一节，查看器还是 14 节。
  const independenceSection = extras.groupNote?.trim()
    ? `${INDEPENDENCE}\n${extras.groupNote.trim()}`
    : INDEPENDENCE;
  const presetSection = extras.presetText?.trim()
    ? [
        '【预设】',
        '以下是主聊天所用预设里的提示词，角色扮演的规则与写法按这里来（最高优先级）；但回复的格式仍是微信短消息（1–3 句短句），不要套用预设里主聊天的正文包裹格式、不要输出那类标签（比如 <game>、<summary>、<options>）。',
        extras.presetText.trim(),
      ].join('\n')
    : '';
  return [
    { key: 'framing', label: '角色扮演开场', content: framing },
    { key: 'identity', label: '身份', content: identity },
    { key: 'affection', label: '好感度', content: affectionSection },
    { key: 'profile', label: '人设', content: profileSection },
    { key: 'settings', label: '设定', content: settingsSection },
    { key: 'lorebook', label: '世界书', content: lorebookSection },
    { key: 'firstMes', label: '开场白', content: firstMesSection },
    { key: 'plot', label: '剧情进度', content: plotSection },
    { key: 'independence', label: '独立系统', content: independenceSection },
    { key: 'thinkFirst', label: '先想一想', content: THINK_FIRST },
    { key: 'noOoc', label: '不跳出角色', content: NO_OOC },
    { key: 'shortStyle', label: '短聊格式', content: SHORT_STYLE },
    { key: 'format', label: '回复格式', content: FORMAT },
    { key: 'preset', label: '预设', content: presetSection },
  ];
}

export function buildReplySystemPrompt(
  card: RPCard,
  contact: PhoneContact,
  extras: ReplyPromptExtras = {},
): string {
  return buildReplySystemPromptSections(card, contact, extras)
    .map((s) => s.content)
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
 * 人数由调用方按发图的描述判断（`inferPeopleFromRequest`：描述里
 * 写了“和用户一起”“合影”就是 duo，写了一群人就是 multi，否则
 * solo）：solo 是角色一个人，duo 是角色和用户两个人，multi 是三人以上。
 * 模型要按这个人数写提示词，画面里每个人的外貌都要写出来——角色按卡
 * 写；用户长什么样聊天记录里没写，不要凭空编一个精致长相，就写他/她是
 * 和角色在一起的那个人；其他人按传进来的联系人（名字、关系）和聊天记录
 * 里提到的样子写，不要编场景里没有的人。最后的人数由调用方用代码强制，
 * 这里只管把每个人的样子写对。
 */
export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  /**
   * 群聊里这条是谁说的（PhoneMessage.characterName）。一对一里不写，
   * 调用方按联系人名字；群聊里写了它，生图提示词和回复上下文才能
   * 分清每句话是谁说的。
   */
  speaker?: string;
}

export interface ImagePromptOptions {
  /** 这张图里有几个人（调用方按发图的描述判断的；不给默认 solo）。 */
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
        '要求：先读最近的微信聊天记录，弄清楚现在的场景：角色现在在哪里、在做什么、周围有什么、光线和气氛怎么样（比如老街、法桐树下、买凉皮、九月的阳光从树叶缝隙漏下来）；再从这个联系人的人设（上面“人设”里写的性格、长相、关键特点，没写人设时从角色卡介绍里找）里提炼出这个角色的外貌特征（头发、眼睛、穿着、标志性特点），让画出来的人一眼就能认出是这个角色；用户和其他人按上面“人数”里说的办法写，不要编场景里没有的人；最后按上面定的人数，把这些人放进这个场景里、正在做这件事，写成一条详细的英文生图提示词（Danbooru 风格标签，逗号分隔，写在一行里）。要的是一张有场景的图，不是白底人像——场景从聊天记录里来，不要只按用户那句短话画，更不要只画一张人像。只输出这条提示词本身，不要解释。',
      ].join('\n'),
    },
  ];
}

/**
 * 生图要转写 Tag 用的上下文（正文）：场景＋人物外貌的自然语言描述。
 *
 * 和 buildImagePromptMessages 共用同一份内容：角色的外貌（卡里的介绍和
 * 性格）、人数（调用方按发图的描述判断的 solo / duo / multi，画面里每个人怎
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
    contact.relation.trim() ? `和用户的关系：${contact.relation.trim()}` : '',
    contact.relationToMain?.trim()
      ? `和主角「${d.name}」的关系：${contact.relationToMain.trim()}`
      : '',
    contact.profile?.trim() ? `人设：${contact.profile.trim()}` : '',
    d.description ? `角色卡介绍（主角「${d.name}」）：${d.description}` : '',
    d.personality ? `主角性格：${d.personality}` : '',
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
          ...others.map((o) => `- ${o.name}（${displayRelation(o)}）`),
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
            (m) =>
              `${m.role === 'assistant' ? (m.speaker ?? contact.name) : '用户'}：${m.content}`,
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
