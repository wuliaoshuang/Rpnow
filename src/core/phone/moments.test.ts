/**
 * 朋友圈纯函数的单元测试。
 */
import { describe, expect, it } from 'vitest';
import type { MomentComment, MomentPost, PhoneContact } from './types.js';
import {
  appendMomentsInteractionLine,
  buildCommentReplyMessages,
  buildMomentPost,
  buildMomentsEntryContent,
  buildMomentsPostMessages,
  dedupeMomentComments,
  formatLikesLine,
  formatMomentsSummaryLine,
  formatMomentsTime,
  momentsEntryHeader,
  momentsInteractionHeader,
  parseMomentCommentLines,
  parseMomentsPostText,
  pickCommentReplier,
} from './moments.js';

const CONTACT: PhoneContact = {
  id: 'c_xiaoyu',
  name: '小雨',
  relation: '室友',
  relationToMain: '闺蜜',
  openingMessage: '小林！',
  gender: 'female',
  profile: '活泼开朗，短发，爱笑，喜欢拉着人出去玩',
};

function post(partial: Partial<MomentPost> = {}): MomentPost {
  return {
    id: 'mp_1',
    contactName: '小雨',
    text: '今天花店的玫瑰开得特别好，忍不住拍了一张。',
    summary: '花店玫瑰开了，心情很好',
    imageDesc: '花店里一束红玫瑰，阳光洒进来',
    location: '花店',
    time: '2026年11月20日 星期五 18:30',
    likers: '阿杰、王阿姨',
    likes: 12,
    comments: [],
    timestamp: 1700000000000,
    imageUrl: '',
    ...partial,
  };
}

const LABELED_POST = [
  '用户名：小雨',
  '朋友圈文案：今天花店的玫瑰开得特别好，忍不住拍了一张。',
  '朋友圈简介：花店玫瑰开了，心情很好',
  '附图：花店里一束红玫瑰，阳光洒进来',
  '发布时间：2026年11月20日 星期五 18:30',
  '发布地点：花店',
  '点赞人列表：阿杰、王阿姨',
  '点赞总数：12',
  '评论：≤阿杰≥:真好看！<br>≤王阿姨≥:玫瑰多少钱一支？<br>回复≤王阿姨≥:不贵，十块。<br>',
].join('\n');

describe('parseMomentsPostText', () => {
  it('按标签解析出文案、简介、附图、时间、地点、点赞和评论', () => {
    const parsed = parseMomentsPostText(LABELED_POST, '小雨');
    expect(parsed.text).toBe('今天花店的玫瑰开得特别好，忍不住拍了一张。');
    expect(parsed.summary).toBe('花店玫瑰开了，心情很好');
    expect(parsed.imageDesc).toBe('花店里一束红玫瑰，阳光洒进来');
    expect(parsed.time).toBe('2026年11月20日 星期五 18:30');
    expect(parsed.location).toBe('花店');
    expect(parsed.likers).toBe('阿杰、王阿姨');
    expect(parsed.likes).toBe(12);
    expect(parsed.comments).toHaveLength(3);
    expect(parsed.comments[0]).toMatchObject({ author: '阿杰', text: '真好看！' });
    expect(parsed.comments[1]).toMatchObject({ author: '王阿姨', text: '玫瑰多少钱一支？' });
    // “回复≤王阿姨≥:”这行没写作者，算发帖人回的。
    expect(parsed.comments[2]).toMatchObject({
      author: '小雨',
      replyTo: '王阿姨',
      text: '不贵，十块。',
    });
  });

  it('模型没按标签写时整段当文案（去掉标签行）', () => {
    const parsed = parseMomentsPostText('今天心情不错，去花店帮忙了。', '小雨');
    expect(parsed.text).toBe('今天心情不错，去花店帮忙了。');
    expect(parsed.likes).toBe(0);
    expect(parsed.comments).toEqual([]);
  });

  it('buildMomentPost：空文案和空时间有兜底', () => {
    const built = buildMomentPost(parseMomentsPostText('', '小雨'), '小雨');
    expect(built.text).toBe('今天心情不错，分享生活。');
    expect(built.time).toBe('刚刚');
    expect(built.contactName).toBe('小雨');
    expect(built.imageUrl).toBe('');
  });
});

describe('parseMomentCommentLines', () => {
  it('四种写法都解析对', () => {
    const lines = parseMomentCommentLines(
      '≤小雨≥ 回复≤阿杰≥:好呀<br>回复≤阿杰≥:行<br>≤王阿姨≥:收租了<br>就这么定了',
      '小雨',
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ author: '小雨', replyTo: '阿杰', text: '好呀' });
    expect(lines[1]).toMatchObject({ author: '小雨', replyTo: '阿杰', text: '行' });
    expect(lines[2]).toMatchObject({ author: '王阿姨', text: '收租了' });
    expect(lines[3]).toMatchObject({ author: '小雨', text: '就这么定了' });
  });

  it('空行和空白评论不要', () => {
    expect(parseMomentCommentLines('  <br>  ', '小雨')).toEqual([]);
  });
});

describe('pickCommentReplier', () => {
  const base = post({
    comments: [
      { id: 'c1', author: '阿杰', text: '好看', timestamp: 1 },
      { id: 'c2', author: '王阿姨', text: '多少钱', timestamp: 2 },
    ],
  });

  it('@ 的人优先', () => {
    const c: MomentComment = { id: 'n', author: '小林', text: '@阿杰 你看', atName: '阿杰', timestamp: 3 };
    expect(pickCommentReplier(base, c)).toBe('阿杰');
  });

  it('没 @ 时被回复的人优先', () => {
    const c: MomentComment = { id: 'n', author: '小林', text: '同意', replyTo: '王阿姨', timestamp: 3 };
    expect(pickCommentReplier(base, c)).toBe('王阿姨');
  });

  it('都没写时发帖人回', () => {
    const c: MomentComment = { id: 'n', author: '小林', text: '好看', timestamp: 3 };
    expect(pickCommentReplier(base, c)).toBe('小雨');
  });

  it('新评论的作者就是 replier 时换别人（先发帖人）', () => {
    const c: MomentComment = { id: 'n', author: '小雨', text: '谢谢大家', timestamp: 3 };
    expect(pickCommentReplier(base, c)).toBe('阿杰');
  });
});

describe('dedupeMomentComments', () => {
  it('按 作者:内容 去重，空内容不要', () => {
    const existing: MomentComment[] = [{ id: 'c1', author: '阿杰', text: '好看', timestamp: 1 }];
    const incoming: MomentComment[] = [
      { id: 'n1', author: '阿杰', text: '好看', timestamp: 2 },
      { id: 'n2', author: '阿杰', text: '真好看', timestamp: 2 },
      { id: 'n3', author: '王阿姨', text: '  ', timestamp: 2 },
    ];
    const added = dedupeMomentComments(existing, incoming);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ author: '阿杰', text: '真好看' });
  });
});

describe('formatLikesLine', () => {
  it('有名有数：X、Y 等 N 人觉得很赞', () => {
    expect(formatLikesLine(post())).toBe('阿杰、王阿姨等12人觉得很赞');
  });
  it('只有数：N 人觉得很赞；都没有：空', () => {
    expect(formatLikesLine(post({ likers: '', likes: 3 }))).toBe('3人觉得很赞');
    expect(formatLikesLine(post({ likers: '', likes: 0 }))).toBe('');
  });
});

describe('formatMomentsSummaryLine / buildMomentsEntryContent', () => {
  it('一行是 [时间] | 简介 | 地点，竖线转全角', () => {
    const line = formatMomentsSummaryLine(post({ summary: '玫瑰 | 阳光', location: '花店 | 后院' }));
    expect(line).toBe('[2026年11月20日 星期五 18:30] 玫瑰 ｜ 阳光 | 花店 ｜ 后院');
  });

  it('没简介时取正文前 40 字，超了加 …', () => {
    const long = '玫瑰'.repeat(30);
    const line = formatMomentsSummaryLine(post({ summary: '', text: long }));
    expect(line).toContain(`${'玫瑰'.repeat(20)}…`);
  });

  it('条目内容：头 + 最新在前的简介行；没动态返回空', () => {
    const p1 = post({ id: 'mp_1', timestamp: 100, summary: '旧的一条' });
    const p2 = post({ id: 'mp_2', timestamp: 200, summary: '新的一条' });
    const content = buildMomentsEntryContent('小雨', [p1, p2]);
    const lines = content.split('\n');
    expect(lines[0]).toBe(momentsEntryHeader('小雨'));
    expect(lines[1]).toContain('新的一条');
    expect(lines[2]).toContain('旧的一条');
    expect(buildMomentsEntryContent('小雨', [])).toBe('');
    expect(buildMomentsEntryContent('阿杰', [p1, p2])).toBe('');
  });
});

describe('appendMomentsInteractionLine', () => {
  it('第一次写带 2 行头，之后追加', () => {
    const first = appendMomentsInteractionLine('', '小雨', '小林', '好美！', 1700000000000);
    expect(first.split('\n')[0]).toBe(momentsInteractionHeader('小雨').split('\n')[0]);
    expect(first).toContain('小林：好美！');
    const second = appendMomentsInteractionLine(first, '小雨', '小雨', '谢谢！', 1700000001000);
    expect(second.split('\n')).toHaveLength(4);
    expect(second).toContain('小雨：谢谢！');
  });

  it('超过 62 行只留头 2 行 + 最近 60 条', () => {
    let content = '';
    for (let i = 0; i < 65; i++) {
      content = appendMomentsInteractionLine(content, '小雨', '小林', `第${i}条`, 1700000000000 + i);
    }
    const lines = content.split('\n');
    expect(lines).toHaveLength(62);
    expect(lines[2]).toContain('第5条');
    expect(lines[61]).toContain('第64条');
  });
});

describe('formatMomentsTime', () => {
  it('格式是 YYYY-MM-DD HH:mm', () => {
    expect(formatMomentsTime(1700000000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('buildMomentsPostMessages', () => {
  it('提示词里有人设、“不要以用户身份发布”、剧情进度和世界书', () => {
    const messages = buildMomentsPostMessages({
      contact: CONTACT,
      userName: '小林',
      wechatHistoryText: '小雨：今天玫瑰开了',
      plotProgress: '主线：军训集合',
      lorebookText: '花店的房东叫王阿姨',
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('活泼开朗，短发');
    expect(text).toContain('绝对不要以用户的身份发布');
    expect(text).toContain('主线：军训集合');
    expect(text).toContain('花店的房东叫王阿姨');
    expect(text).toContain('朋友圈文案');
    expect(text).toContain('朋友圈简介');
  });
});

describe('buildCommentReplyMessages', () => {
  it('提示词里有帖子内容、已有评论、新评论和 replier 优先', () => {
    const p = post({
      comments: [{ id: 'c1', author: '阿杰', text: '好看', timestamp: 1 }],
    });
    const messages = buildCommentReplyMessages({
      post: p,
      replierName: '小雨',
      replierProfile: '活泼开朗',
      replierMemory: '小雨今天在花店',
      newComment: { id: 'n', author: '小林', text: '好美！', timestamp: 2 },
      commentsText: '阿杰：好看',
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('优先让 小雨 回复这条评论');
    expect(text).toContain('花店的玫瑰开得特别好');
    expect(text).toContain('小林：好美！');
    expect(text).toContain('活泼开朗');
    expect(text).toContain('最多再让1个其他角色附和一句');
  });

  it('新评论的作者就是 replier 时写明换别人回', () => {
    const messages = buildCommentReplyMessages({
      post: post(),
      replierName: '小雨',
      replierProfile: '',
      replierMemory: '',
      newComment: { id: 'n', author: '小雨', text: '谢谢大家', timestamp: 2 },
      commentsText: '（暂无评论）',
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('换一个其他角色回复');
  });
});
