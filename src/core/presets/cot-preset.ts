/**
 * COT 预设动态生成（F06）。
 *
 * 与 `core/prompt/cot.ts` 的解析是两回事：那里是把模型输出里的
 * `<thinking>/<cot>` 剥出来；这里是**按需生成**一段指导模型“先想后写”
 * 的 `<thinking_protocol>` 预设文本，随每次组装提示词时根据当前上下文
 * 动态拼出来（记忆是否启用、UI 模板是否启用、剧情面板是否启用、
 * 模型适合用哪个思考标签），而不是存一段写死的文本。
 *
 * 结构与 RP-Hub 的 COT 预设同源（记忆整理 / 情景意图 / 设定分析 /
 * 信息边界 / 剧情规划 / 变量更新 / 最终检查），文字为自行重写。
 */

import { cotTagFor, type CotTag } from '../prompt/cot.js';

export interface CotPresetOptions {
  /** 记忆系统是否启用：启用时加入“记忆整理”一节。 */
  memoryEnabled?: boolean;
  /** UI 模板是否启用：启用时加入“变量更新分析”一节。 */
  uiTemplateEnabled?: boolean;
  /** 剧情面板是否启用：启用时在剧情规划里加入面板判断。 */
  storyPanelsEnabled?: boolean;
  /** 强制用哪个思考标签；不填时按模型名推断。 */
  useThinkingTag?: boolean;
  /** 当前模型名（用于推断思考标签）。 */
  model?: string;
  /**
   * 破限预注入阶段：1 = 用户刚要求“先分析续写难点”，
   * 2 = 用户已切换成“直接续写”。0 / 不填 = 正常轮次。
   */
  prefillPhase?: 0 | 1 | 2;
  /** 预注入阶段是否真的把分析前置到回复里。 */
  prefillEnabled?: boolean;
  /** 预注入阶段要接在分析后面的正文（已去掉旧思考标签）。 */
  prefillBaseContent?: string;
}

/** 按模型名决定思考标签（DeepSeek/GLM/Kimi 类用 thinking，其余用 cot）。 */
export function cotTagForPreset(model: string | undefined, useThinkingTag?: boolean): CotTag {
  if (useThinkingTag !== undefined) return useThinkingTag ? 'thinking' : 'cot';
  return cotTagFor(model ?? '');
}

const MEMORY_CITATION_COT_LINE =
  '- 主动找出本轮能承接的记忆并记下编号（如 M12），写到对应剧情时在句末标注，每个编号只标一次，不要漏标。';

/**
 * 动态生成 COT 预设文本。
 *
 * 正常轮次返回 `<thinking_protocol>…</thinking_protocol>`；
 * 预注入阶段（prefillPhase 1/2）返回按该阶段裁剪的分析段，
 * prefillEnabled 为 false 时只返回去掉旧思考标签的正文。
 */
export function buildCotPreset(opts: CotPresetOptions = {}): string {
  const tag = cotTagForPreset(opts.model, opts.useThinkingTag);
  const memoryEnabled = opts.memoryEnabled ?? false;
  const uiTemplateEnabled = opts.uiTemplateEnabled ?? false;

  if (opts.prefillPhase === 1 || opts.prefillPhase === 2) {
    const phase = opts.prefillPhase;
    const sections = [
      memoryEnabled
        ? '[记忆整理]\n上条消息本身没有提供可核对的剧情记忆，本轮没有新增记忆事实。'
        : '',
      phase === 1
        ? '[情景意图分析]\n用户这次没有给剧情，而是要求先分析续写难点。也就是说，本轮要回答的是“怎样避免写偏”，不是开始编造角色和场景。'
        : '[情景意图分析]\n用户已经把任务从“分析难点”切换成“直接续写”。前面的准备到此结束，下一步应读取后续设定和历史，从最后一个真实事件接着写。',
      phase === 1
        ? '[设定分析]\n当前还没有角色卡、世界书、历史或现场信息，所以没有人物动机可以判断；只能确认后续必须等这些资料出现，不能拿通用人设代替。'
        : '[设定分析]\n真正的角色动机和现场状态要从后续角色卡、世界书、历史和用户输入中确定；现在只能先把“直接续写”作为输出方向，不能提前替角色做决定。',
      phase === 1
        ? '[信息边界]\n目前唯一确定的事实是用户要求先做困难分析；人物、地点、关系和事件结果都还没有来源，不能把它们写成已经发生。'
        : '[信息边界]\n目前能确定的是用户要求开始续写，具体剧情事实仍要以随后提供的上下文为准；用户没有写出的台词、决定和内心不能被我补出来。',
      phase === 1
        ? '[剧情规划]\n本轮只需确认几个会直接影响续写的难点：从长上下文找出关键事实、保持角色连续、分清谁知道什么。'
        : '[剧情规划]\n收到后续上下文后，先找出最近一个有效事件，再用对白或行动让局面产生变化。',
      uiTemplateEnabled
        ? '[变量更新分析]\n这两条预注入消息只是在确认输出流程，没有发生剧情变化，因此没有变量需要更新。'
        : '',
      phase === 1
        ? '[最终检查]\n这次回复应当是对困难的实际判断，不是把规则再抄一遍；不生成虚构正文，保留后续续写需要的上下文。'
        : '[最终检查]\n确认后续正文有明确承接点，没有替用户行动，也没有把准备说明混进剧情；按文风完成检查后直接续写。',
    ].filter(Boolean);
    const base = (opts.prefillBaseContent ?? '')
      .replace(/<(thinking|think|cot)>[\s\S]*?<\/\s*\1\s*>\s*/gi, '')
      .trimStart();
    if (!opts.prefillEnabled) return base;
    return `<${tag}>\n${sections.join('\n\n')}\n</${tag}>\n${base}`;
  }

  const memorySection = memoryEnabled
    ? `\n[记忆整理]\n- 整理当前提供的总结记忆、召回记忆或已经确认的具体事实，直接落到时间、人物、关系、行动结果、物品状态和未解事件上，理清时间线与剧情发展脉络；旧记忆不得当作当前现场，不要复述处理步骤。\n${MEMORY_CITATION_COT_LINE}\n`
    : '';
  const uiSection = uiTemplateEnabled
    ? `\n[变量更新分析]\n依据本轮规划的剧情结果，逐项检查系统提供的当前变量，只记录确实需要变化的字段、新值和依据。最终变量块按系统格式放在正文结束后。\n`
    : '';
  const panelsLine = opts.storyPanelsEnabled
    ? '\n- 面板：判断本轮哪些信息值得通过剧情 UI 面板展示，明确面板内容、插入位置及设计样式；有展示价值时积极安排，不复述正文或照搬上轮面板。'
    : '';
  // 开场白只列出本轮实际启用的小节（未启用的不出现，避免模型硬凑）。
  const labels = [
    ...(memoryEnabled ? ['[记忆整理]'] : []),
    '[情景意图分析]',
    '[设定分析]',
    '[信息边界]',
    '[剧情规划]',
    ...(uiTemplateEnabled ? ['[变量更新分析]'] : []),
    '[最终检查]',
  ].join('/');

  return `<thinking_protocol>
在<${tag}>标签中使用中文输出包含${labels}的完整的本轮分析，只完成必要判断，不在其中试写或复述正文，并严格按以下顺序进行，不得省略任何内容：
${memorySection}
[情景意图分析]
- 现场：确认此刻的时间、地点、在场人物和最后发生的事件，按正确顺序理清相关历史，以及仍在延续的关系和情绪。
- 输入：完整承接 {{user}} 已明确给出的言行，分析其中的情绪、潜台词和真实需求，不擅自解释或补全其意图。

[设定分析]
结合角色设定、世界观和当前处境，判断相关角色此刻最合理的动机、边界和反应方式，以及环境会给行动带来的具体影响。

[信息边界]
- 分别确认各角色此刻掌握的信息及其来源，区分亲历、被告知、合理推断与未知。
- 未在场事件、他人内心、旁白信息、隐藏设定及仅向其他角色展示的内容，未经观察或传递不得知晓；推断只能作为人物判断，不得写成已确认事实，角色之间不得自动共享认知。

[剧情规划]
- 焦点：选出本轮最有因果作用的角色、群体或事件，不把 {{user}} 默认当成主角或叙事中心。
- 推进：确定通过哪些对白、选择、行动结果或关系反应让局面发生变化，以及是否需要停在等待 {{user}} 回应的位置。
- 规则：当前剧情已经进入或正在明确推进 NSFW 内容时应用 <nsfw_rules>，否则忽略。${panelsLine}
${uiSection}
[最终检查]
确认人物没有失真或越过认知边界、剧情因果成立、没有替 {{user}} 补写言行，再按文风做最终检查。

最后输出</${tag}>闭合标签后再进行正式的输出。
</thinking_protocol>`.replace(/\n{3,}/g, '\n\n');
}
