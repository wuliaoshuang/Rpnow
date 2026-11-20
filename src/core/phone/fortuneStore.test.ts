/**
 * 运势存取（fortuneStore.ts）的单元测试。
 *
 * IndexedDB 的读写在 Playwright 里验（测试环境是 node，没有 IndexedDB）；
 * 这里测能用内存假 store 的 removeFortune 和 emptyFortuneState。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import { emptyFortuneState, removeFortune } from './fortuneStore.js';

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

describe('emptyFortuneState', () => {
  it('运势和塔罗都还没有', () => {
    expect(emptyFortuneState()).toEqual({ horoscope: null, tarot: null });
  });
});

describe('removeFortune', () => {
  it('删掉指定聊天的运势，其他聊天的不动', async () => {
    const { store, map } = fakeStore();
    map.set('rpnow:phone:fortune:chat1', { horoscope: null, tarot: null });
    map.set('rpnow:phone:fortune:chat2', { horoscope: null, tarot: null });
    await removeFortune('chat1', store);
    expect(map.has('rpnow:phone:fortune:chat1')).toBe(false);
    expect(map.has('rpnow:phone:fortune:chat2')).toBe(true);
  });
});
