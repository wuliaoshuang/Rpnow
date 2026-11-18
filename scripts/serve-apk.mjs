/**
 * 临时 APK 下载服务（用于手机直接安装）。
 * 用法：node scripts/serve-apk.mjs [apk路径] [端口]
 */
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createServer } from 'node:http';

const file = process.argv[2] ?? 'release/RPNow_0.1.0_android-arm64.apk';
const port = Number(process.argv[3] ?? 8798);
const name = basename(file);

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url !== `/${name}` && url !== '/') {
    res.writeHead(404).end('not found');
    return;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch {
    res.writeHead(404).end('apk missing');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="${name}"`,
  });
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log(`APK 下载服务已启动: http://0.0.0.0:${port}/${name}`);
});
