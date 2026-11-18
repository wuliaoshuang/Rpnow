/**
 * Backup & updates panel.
 *
 * Backup is opt-in and points at a self-hosted endpoint: the client only ever
 * sends content-addressed blobs, and the 16-character key is what the user
 * keeps. With no server configured the section explains that rather than
 * pretending to work.
 */

import * as React from 'react';
import { CloudUpload, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { downloadBackup, getBlob, isValidKey, makeBlob, normalizeKey, uploadBackup, type BackupManifest } from '@/core/backup/client.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import type { MemoryRecord } from '@/core/memory/types.js';
import type { NovelState } from '@/core/novel/types.js';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';

export function BackupSettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const cards = useApp((s) => s.cards);
  const chats = useApp((s) => s.chats);
  const novel = useApp((s) => s.novel);
  const memories = useApp((s) => s.memories);
  const saveCard = useApp((s) => s.addCard);
  const saveChat = useApp((s) => s.saveChat);
  const saveNovel = useApp((s) => s.saveNovel);
  const saveMemories = useApp((s) => s.saveMemories);

  const [busy, setBusy] = React.useState<'upload' | 'restore' | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [key, setKey] = React.useState('');
  const [info, setInfo] = React.useState<string | null>(null);

  const serverURL = settings.backup.serverURL.trim();
  const configured = Boolean(serverURL);

  const runUpload = async () => {
    if (!configured) return;
    setBusy('upload');
    setProgress({ done: 0, total: 0 });
    setInfo(null);
    try {
      const blobs = [];
      const characters = [];
      for (const card of cards) {
        const blob = await makeBlob(card);
        blobs.push(blob);
        characters.push({ id: card.id, name: card.data.name, hash: blob.hash });
      }
      const scopes = [];
      for (const chat of chats) {
        const blob = await makeBlob(chat);
        blobs.push(blob);
        scopes.push({ key: chat.id, hash: blob.hash });
      }
      for (const [chatId, list] of Object.entries(memories)) {
        const blob = await makeBlob({ chatId, list });
        blobs.push(blob);
        scopes.push({ key: `memory:${chatId}`, hash: blob.hash });
      }
      const novelBlob = await makeBlob(novel);
      blobs.push(novelBlob);
      scopes.push({ key: 'novel', hash: novelBlob.hash });

      const total = blobs.reduce((sum, b) => sum + b.bytes.length, 0);
      setProgress({ done: 0, total });

      const manifest: BackupManifest = {
        type: 'rpnow-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        characters,
        scopes,
      };
      const backupKey = await uploadBackup({
        baseURL: serverURL,
        blobs,
        manifest,
        onProgress: (done) => setProgress({ done, total }),
      });
      setInfo(`备份密钥：${backupKey}（15 天内有效，请妥善保存）`);
      toast.success('备份完成', `密钥 ${backupKey}`);
    } catch (err) {
      toast.error('备份失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const runRestore = async () => {
    if (!configured) return;
    const normalized = normalizeKey(key);
    if (!isValidKey(normalized)) {
      toast.error('密钥格式不正确', '需要 16 位字母数字（O 会按 0、I/L 会按 1 处理）');
      return;
    }
    if (!(await confirmAction({ title: '确认操作', description: `确定要用密钥 ${normalized} 恢复吗？同名角色卡与聊天会被覆盖。` }))) return;
    setBusy('restore');
    setInfo(null);
    try {
      const manifest = await downloadBackup(serverURL, normalized);
      let cardsRestored = 0;
      let chatsRestored = 0;
      let memoriesRestored = 0;

      // Download every blob and write it back through the normal store actions,
      // so the rest of the app sees exactly the same state as a local edit.
      for (const ref of manifest.characters) {
        try {
          const card = (await getBlob(serverURL, ref.hash)) as RPCard;
          if (!card?.id) continue;
          await saveCard(card);
          cardsRestored++;
        } catch (err) {
          console.warn('[backup] 卡片块恢复失败', ref.hash, err);
        }
      }

      for (const scope of manifest.scopes) {
        try {
          if (scope.key === 'novel') {
            const novel = (await getBlob(serverURL, scope.hash)) as NovelState;
            if (novel?.books) await saveNovel(novel);
            continue;
          }
          if (scope.key.startsWith('memory:')) {
            const chatId = scope.key.slice('memory:'.length);
            const payload = (await getBlob(serverURL, scope.hash)) as {
              chatId: string;
              list: MemoryRecord[];
            };
            await saveMemories(payload?.chatId ?? chatId, payload?.list ?? []);
            memoriesRestored++;
            continue;
          }
          const chat = (await getBlob(serverURL, scope.hash)) as RPChat;
          if (chat?.id) {
            await saveChat(chat);
            chatsRestored++;
          }
        } catch (err) {
          console.warn('[backup] 数据块恢复失败', scope.key, err);
        }
      }

      setInfo(
        `已恢复 ${cardsRestored} 张角色卡、${chatsRestored} 份对话、${memoriesRestored} 份记忆。`,
      );
      toast.success('恢复完成', `${cardsRestored} 张角色卡 · ${chatsRestored} 份对话`);
    } catch (err) {
      toast.error('恢复失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="backup-url">备份服务器地址</Label>
        <Input
          id="backup-url"
          value={settings.backup.serverURL}
          onChange={(e) => setSettings({ backup: { ...settings.backup, serverURL: e.target.value } })}
          placeholder="https://your-backup.example.com"
          autoComplete="off"
        />
        <p className="text-[11px] leading-relaxed text-[var(--rp-fg-subtle)]">
          留空则关闭云备份。备份内容按内容哈希去重上传，只保存 16 位密钥即可恢复；密钥 15 天有效。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void runUpload()} disabled={!configured || busy !== null}>
          {busy === 'upload' ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" aria-hidden="true" />}
          立即备份
        </Button>
        <div className="flex items-center gap-2">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="输入 16 位备份密钥"
            className="max-w-56"
            aria-label="备份密钥"
            autoComplete="off"
          />
          <Button variant="outline" onClick={() => void runRestore()} disabled={!configured || busy !== null}>
            {busy === 'restore' ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
            恢复
          </Button>
        </div>
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]">
            <div className="h-full rounded-full bg-[var(--rp-accent)] transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">{percent}%</p>
        </div>
      )}

      {info && (
        <p className="rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-2.5 text-[12px]">{info}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="update-url">更新检测地址（可选）</Label>
        <Input
          id="update-url"
          value={settings.update.checkURL}
          onChange={(e) => setSettings({ update: { ...settings.update, checkURL: e.target.value } })}
          placeholder="https://your-server.example.com"
          autoComplete="off"
        />
        <p className="text-[11px] text-[var(--rp-fg-subtle)]">
          填写后每 20 秒查询一次 <code className="rounded bg-[var(--rp-bg-sunken)] px-1">/v1/version</code>，用于显示更新公告；查询失败不影响使用。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const url = settings.update.checkURL.trim();
            if (!url) {
              toast.info('未配置更新地址');
              return;
            }
            try {
              const res = await fetch(`${url}/v1/version`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const json = (await res.json()) as { version?: string; title?: string; content?: string; id?: number };
              setInfo(`最新版本：${json.version ?? '未知'}${json.title ? ` — ${json.title}` : ''}`);
              toast.success('已是最新', json.version ?? '');
            } catch (err) {
              toast.error('检查失败', err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> 立即检查更新
        </Button>
      </div>
    </div>
  );
}
