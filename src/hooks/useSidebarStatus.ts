/**
 * 侧边栏三行状态（用户身份 / API 连接 / 生图 API）的唯一真相来源。
 *
 * 之前 SettingsPanel / GlobalDrawer / ChatDrawer 各自复制了一份判断逻辑，
 * 且三处各有不同的错：身份只认当前聊天、API 行是写死字符串、生图读的是
 * 另一套自动生图系统的 key。此 hook 集中算一次，三处共用。
 *
 * 规则：
 * - 用户身份：当前聊天的 persona → settings.defaultPersonaId → personas[0]
 * - API 连接：settings.defaultConnectionId → llmConnections[0]，显示连接名
 * - 生图 API：imageConnections 列表（设置 → 生图 API 配的就是它）；
 *   自动生图（settings.imageGen.key）是另一套系统，单独一行显示
 */
import { useApp } from '@/state/store.js';

export interface SidebarStatus {
  /** 显示用的身份名，未配置时为 undefined（调用方显示“未设置”）。 */
  personaName?: string;
  /** 显示用的 API 连接名，未配置时为 undefined。 */
  apiConnectionName?: string;
  /** 是否配了生图连接。 */
  imageConfigured: boolean;
  /** 是否配了自动生图 key（另一套系统）。 */
  autoImageConfigured: boolean;
}

export function useSidebarStatus(chatPersonaId?: string): SidebarStatus {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  const llmConnections = useApp((s) => s.llmConnections);
  const imageConnections = useApp((s) => s.imageConnections);

  const persona =
    personas.find((p) => p.id === chatPersonaId) ??
    personas.find((p) => p.id === settings.defaultPersonaId) ??
    personas[0];
  const apiConnection =
    llmConnections.find((c) => c.id === settings.defaultConnectionId) ?? llmConnections[0];

  return {
    personaName: persona?.name,
    apiConnectionName: apiConnection?.name,
    imageConfigured: imageConnections.length > 0,
    autoImageConfigured: Boolean(settings.imageGen?.key),
  };
}
