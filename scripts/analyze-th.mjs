import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';

const buf = readFileSync('tavern-helper-real.zip');
const zip = await JSZip.loadAsync(buf);
const names = Object.keys(zip.files);
console.log('total files:', names.length);

// 顶层结构
const tops = new Set(names.map((n) => n.split('/')[0]));
console.log('top-level:', [...tops].join(', '));

// 找 manifest
const manifests = names.filter((n) => /(^|\/)manifest\.json$/i.test(n));
console.log('manifests:', manifests.slice(0, 10));

const manifest = manifests.length ? JSON.parse(await zip.file(manifests[0]).async('text')) : null;
console.log('manifest:', JSON.stringify(manifest, null, 1).slice(0, 800));

// dist 目录
const dist = names.filter((n) => /(^|\/)dist\//.test(n));
console.log('\ndist files:', dist.length);
console.log(dist.slice(0, 40).join('\n'));

// JS 文件统计
const js = names.filter((n) => /\.m?js$/i.test(n));
console.log('\njs files:', js.length, 'total bytes:', js.reduce((s, n) => s + (zip.files[n]. _data?.uncompressedSize ?? 0), 0));
