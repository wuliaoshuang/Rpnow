/**
 * Promise-based confirm dialog, built on the shared Radix Dialog wrapper.
 *
 * `confirmAction({ title, ... })` returns `Promise<boolean>` and can be awaited
 * anywhere (event handlers, guards). `<ConfirmHost />` mounts once near the app
 * root; it portals through Radix so it always sits above the page — including
 * pages inside the push-aside transform, where plain `fixed` elements would be
 * re-anchored.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.js';
import { Button } from './button.js';

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

let push: ((req: ConfirmRequest) => void) | null = null;

export function confirmAction(opts: {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) {
      // No host mounted (should not happen): fail safe rather than block.
      resolve(false);
      return;
    }
    push({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = React.useState<ConfirmRequest | null>(null);
  React.useEffect(() => {
    push = (r) => setReq(r);
    return () => {
      push = null;
    };
  }, []);

  const settle = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };

  return (
    <Dialog open={req !== null} onOpenChange={(o) => !o && settle(false)}>
      <DialogContent className="max-w-sm">
        {req && (
          <>
            <DialogHeader>
              <DialogTitle>{req.title}</DialogTitle>
              {req.description && <DialogDescription>{req.description}</DialogDescription>}
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {req.cancelText ?? '取消'}
              </Button>
              <Button
                variant={req.destructive ? 'destructive' : 'default'}
                size="sm"
                onClick={() => settle(true)}
              >
                {req.confirmText ?? '确定'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
