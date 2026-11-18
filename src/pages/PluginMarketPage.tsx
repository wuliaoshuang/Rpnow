/**
 * 插件商店：只卖插件。kind 写死 'plugin'，安装只走插件安装并刷新内核。
 *
 * 无 NSFW 开关（插件无分级）；详情常驻“声明的权限”块。
 * 发布入口只列已安装插件（不再有角色卡下拉）。
 */

import { useEffect, useState } from 'react';
import { useApp } from '@/state/store.js';
import { Button } from '@/components/ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input.js';
import { reloadInstalledPlugins } from '@/boot.js';
import { install as installPlugin, listInstalled, parseRpnx } from '@/core/plugins/rpnx.js';
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

export function PluginMarketPage() {
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [publishSubject, setPublishSubject] = useState<string | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<Array<{ id: string; name: string }>>([]);
  // 顶栏的发布内容按钮通过 store 发请求，页面接住后打开选择器并清掉请求。
  const publishRequest = useApp((s) => s.publishStoreRequest);
  useEffect(() => {
    if (publishRequest === 'plugin') {
      useApp.getState().requestStorePublish(null);
      setPublishPickerOpen(true);
    }
  }, [publishRequest]);

  useEffect(() => {
    void listInstalled()
      .then((list) => setInstalledPlugins(list.map((p) => ({ id: p.manifest.id, name: p.manifest.name }))))
      .catch(() => setInstalledPlugins([]));
  }, []);

  async function handleInstall(item: MarketItem) {
    if (!item.versions.length) return;
    const version = item.versions[0];
    const pkg = await downloadPackage(item.manifest.id, version);
    const pub = await readPublishManifest(pkg);
    if (pub.type !== 'plugin') throw new Error('该发布包不是插件');
    const parsed = await parseRpnx(pkg);
    await installPlugin(parsed, true);
    // 插件装完立即刷新内核，否则切到插件页要手动刷新才看得到。
    await reloadInstalledPlugins();
  }

  return (
    <>
      <StoreShell
        kind="plugin"
        showNsfwToggle={false}
        permissionsAlwaysVisible
        onInstall={handleInstall}
      />

      {/* 发布来源选择：只列已安装插件 */}
      <Dialog open={publishPickerOpen} onOpenChange={(o) => !o && setPublishPickerOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发布到商店</DialogTitle>
            <DialogDescription>选择要打包的插件，随后填写元数据并上传。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium">插件</label>
            <Select
              value=""
              onValueChange={(id) => {
                if (id) setPublishSubject(id);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={`选择已安装插件（${installedPlugins.length}）`} />
              </SelectTrigger>
              <SelectContent>
                {installedPlugins.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
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
        kind="plugin"
        subjectId={publishSubject ?? ''}
        open={!!publishSubject}
        onClose={() => setPublishSubject(null)}
      />
    </>
  );
}
