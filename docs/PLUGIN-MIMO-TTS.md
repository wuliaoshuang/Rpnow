# MiMo TTS 朗读插件

用小米 **MiMo-TTS** 朗读角色回复。安装后可对任意消息一键听读，自动剥离 HTML / Markdown / 卡内标签，只读正文。

- 插件文件：`release/rpnow.tts.mimo.rpnx`（4 KB）
- 源码目录：`plugins/mimo-tts/`
- 安装：应用内「插件 → 安装 .rpnx」

## 接口要点（易踩坑）

MiMo 的 TTS **不是** OpenAI 的 `/v1/audio/speech`（该路径返回 openresty HTML 404），而是走 **Chat Completions**：

```http
POST https://api.xiaomimimo.com/v1/chat/completions
api-key: <MIMO_API_KEY>          # 也支持 Authorization: Bearer
Content-Type: application/json

{
  "model": "mimo-v2.5-tts",
  "messages": [
    { "role": "user",      "content": "语气温柔" },   // 可选：风格指令
    { "role": "assistant", "content": "要朗读的正文" } // 必需：正文放这里
  ],
  "audio": { "voice": "冰糖", "format": "wav" }
}
```

音频在 `choices[0].message.audio.data`，base64 编码。

预置音色（`mimo-v2.5-tts` 只能用它）：`mimo_default`、`冰糖`、`茉莉`、`苏打`、`白桦`、`Mia`、`Chloe`、`Milo`、`Dean`。

官方文档：[语音合成（MiMo-TTS 系列）](https://mimo.mi.com/docs/zh-CN/api/audio/tts-post)

## 配置

安装后在「插件」页点插件卡片右侧的**齿轮**：

| 字段 | 默认值 | 说明 |
|---|---|---|
| MiMo API Key | — | 控制台获取，`tp-` 或 `sk-` 开头 |
| 接口地址 | `https://api.xiaomimimo.com/v1` | 必须以 `/v1` 结尾 |
| 模型 | `mimo-v2.5-tts` | 另有 `-voiceclone`（需传参考音频）、`-voicedesign` |
| 音色 | `冰糖` | 见上表 |
| 音频格式 | `wav` | 或 `mp3` |
| 风格指令 | 空 | 作为 user 消息发送，如「语气温柔、语速偏慢」 |

## 朗读时的处理

目标是把一段角色回复变成自然、连贯的语音，而不是逐字念出标记：

1. **剥离非正文**：`<style>` / `<script>` / 所有 HTML 与卡内自定义标签（`<status>` 等）、代码块、图片。
2. **剥离 Markdown**：标题符号、加粗斜体标记、列表符号、链接只保留文字。
3. **解析宏**：`{{char}}` / `{{user}}` 替换成真实名字；其余 `{{…}}` 直接丢弃，绝不会把花括号念出来。
4. **按句切分**：只在真正的句末标点处断开；**引号内不断句**——`「这么晚。」他笑了` 是一句，不会被切碎；跨段落的对话不会被拆散。
5. **流式排队**：首句一到就开始播放，同时预取后续两句，句子之间几乎无停顿。

## 实现说明

插件通过内核的 `tts` 服务键工作：

```js
ctx.provide('tts', {
  label: 'MiMo TTS',
  ready() { ... },
  voices() { ... },
  speak({ text, voice, instruction, signal }) { ... },
});
```

界面在消息操作栏里有一个朗读按钮，**只有 `tts` 服务存在时才显示**——所以装/卸插件不需要改任何核心代码。想换别家 TTS（Azure、ElevenLabs、GPT-SoVITS…）就写一个同样 `provide('tts')` 的 `.rpnx`，界面自动接管。

## 已知限制

- **浏览器里用不了**：`api.xiaomimimo.com` 不返回 CORS 头，必须用**桌面版或安卓版**（原生网络），或在网页版配置代理。
- 长回复会分多次请求（每句一次），按句计费，成本与文本长度成正比。
- 未实现边生成边朗读（目前是回复结束后点按钮朗读）。
- `voicedesign` / `voiceclone` 模型的额外参数未在配置表单中暴露。

## 重新打包

```bash
node scripts/build-plugin.mjs plugins/mimo-tts release/rpnow.tts.mimo.rpnx
```
