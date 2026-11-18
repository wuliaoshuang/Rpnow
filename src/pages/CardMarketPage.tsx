/**
 * 角色卡商店：只卖角色卡。kind 写死 'card'，安装只写卡库。
 *
 * 发布入口只列本地角色卡（不再有插件下拉）。
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input.js';
import { useApp } from '@/state/store.js';
import { parseCardFile } from '@/core/card/parser.js';
import { downloadPackage } from '@/core/marketplace/client.js';
import { readPublishManifest } from '@/core/marketplace/packaging.js';
import type { MarketItem } from '@/core/marketplace/types.js';
import { StoreShell } from '@/components/marketplace/StoreShell.js';
import { PublishWizard } from '@/components/marketplace/PublishWizard.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';

export function CardMarketPage() {
  const cards = useApp((s) => s.cards);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [publishSubject, setPublishSubject] = useState<string | null>(null);
  // 顶栏的发布内容按钮通过 store 发请求，页面接住后打开选择器并清掉请求。
  const publishRequest = useApp((s) => s.publishStoreRequest);
  useEffect(() => {
    if (publishRequest === 'card') {
      useApp.getState().requestStorePublish(null);
      setPublishPickerOpen(true);
    }
  }, [publishRequest]);

  async function handleInstall(item: MarketItem) {
    if (!item.versions.length) return;
    const version = item.versions[0];
    const pkg = await downloadPackage(item.manifest.id, version);
    const pub = await readPublishManifest(pkg);
    if (pub.type !== 'card') throw new Error('该发布包不是角色卡');
    // 整包交给解析器：它从 card.json 读卡面数据，并把包里的 avatar.png 一起带上；
    // 只拆 card.json 的话，装好的卡会丢头像。
    const parsed = await parseCardFile(pkg, `${pub.name}.rpcard`);
    await useApp.getState().addCard(parsed.card);
  }

  return (
    <>
      <StoreShell
        kind="card"
        showNsfwToggle
        permissionsAlwaysVisible={false}
        onInstall={handleInstall}
      />

      {/* 发布来源选择：只列角色卡 */}
      <Dialog open={publishPickerOpen} onOpenChange={(o) => !o && setPublishPickerOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发布到商店</DialogTitle>
            <DialogDescription>选择要打包的角色卡，随后填写元数据并上传。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">角色卡</label>
            <Select
              value=""
              onValueChange={(id) => {
                if (id) setPublishSubject(id);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={`选择卡片（${cards.length}）`} />
              </SelectTrigger>
              <SelectContent>
                {cards.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.data.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              disabled={!publishSubject}
              onClick={() => {
                setPublishPickerOpen(false);
              }}
            >
              下一步
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PublishWizard
        kind="card"
        subjectId={publishSubject ?? ''}
        open={!!publishSubject}
        onClose={() => setPublishSubject(null)}
      />
    </>
  );
}
