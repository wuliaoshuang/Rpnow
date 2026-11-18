/**
 * 给本地商店写入一条种子内容（便于体验/回归）。
 * 用法：node scripts/seed-market.mjs [名称]
 */
import JSZip from 'jszip';

const name = process.argv[2] ?? '示例卡·小店欢迎';
const zip = new JSZip();
const id = `card.demo.${Date.now().toString(36)}`;
zip.file(
  'publish.json',
  JSON.stringify(
    {
      type: 'card',
      schema: 1,
      id,
      name,
      version: '1.0.0',
      summary: '本地商店的种子内容，用于验证浏览/安装流程。',
      author: 'RPNow',
      license: 'CC-BY-4.0',
      category: 'modern',
      tags: ['示例'],
      rating: 'sfw',
      contentWarnings: [],
      screenshots: [],
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
zip.file('card.json', JSON.stringify({ spec: 'chara_card_v2', data: { name, description: '由种子脚本写入。' } }, null, 2));
const buf = await zip.generateAsync({ type: 'nodebuffer' });
const res = await fetch('http://127.0.0.1:8799/v1/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    manifest: JSON.parse(await zip.file('publish.json').async('string')),
    base64: buf.toString('base64'),
  }),
});
console.log('seed:', res.status, await res.text());
