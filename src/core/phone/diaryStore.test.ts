/**
 * 日记存取（diaryStore.ts）的单元测试。
 *
 * IndexedDB 的读写在 Playwright 里验（测试环境是 node，没有 IndexedDB）；
 * 这里测能用内存假 store 的 removeDiary。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import { removeDiary } from './diaryStore.js';

/** 内存假 store：实现 StorageService 接口，行为与 idbStorage 一致。 */
function fakeStore() {
  const map = new Map<string, unknown>();
  const store: StorageService = {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
    async keys(prefix?: string): Promise<string[]> {
      return [...map.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async clear(): Promise<void> {
      map.clear();
    },
  };
  return { store, map };
}

describe('removeDiary', () => {
  it('删掉指定聊天的日记，其他聊天的不动', async () => {
    const { store, map } = fakeStore();
    map.set('rpnow:phone:diary:chat1', [{ id: 'de_1' }]);
    map.set('rpnow:phone:diary:chat2', [{ id: 'de_2' }]);
    await removeDiary('chat1', store);
    expect(map.has('rpnow:phone:diary:chat1')).toBe(false);
    expect(map.has('rpnow:phone:diary:chat2')).toBe(true);
  });
});
