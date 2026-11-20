/**
 * 小手机主屏幕应用注册表的单元测试。
 */
import { describe, expect, it } from 'vitest';
import { PHONE_APPS, phoneAppById, phoneAppIds } from './apps.js';

describe('PHONE_APPS', () => {
  it('主屏幕上有微信、朋友圈、相册三个应用', () => {
    expect(phoneAppIds()).toEqual(['wechat', 'moments', 'album']);
    expect(PHONE_APPS.map((a) => a.label)).toEqual(['微信', '朋友圈', '相册']);
  });

  it('id 不重复，每个应用都有图标', () => {
    const ids = new Set(PHONE_APPS.map((a) => a.id));
    expect(ids.size).toBe(PHONE_APPS.length);
    for (const app of PHONE_APPS) {
      expect(app.icon).toBeTruthy();
      expect(app.color).toBeTruthy();
    }
  });

  it('phoneAppById：找得到朋友圈，找不到返回 undefined', () => {
    expect(phoneAppById('moments')?.label).toBe('朋友圈');
    expect(phoneAppById('wallet')).toBeUndefined();
  });
});
