# 随口咖微信小程序

这是原生 WXML/WXSS/JavaScript 版本，不依赖框架。

## 打开与构建

1. 在微信开发者工具中选择「导入项目」。
2. 项目目录选择仓库里的 `miniprogram/`。
3. 当前 `appid` 是 `touristappid` 占位值；正式使用前在 `miniprogram/project.config.json` 替换。
4. 根目录运行 `npm run build:mp` 可重新生成 `miniprogram/lib/core.js`，该构建文件需要随项目提交。
5. 如需启用云端意图解析，在 `pages/index/index.js` 顶部把 `RELAY` 填为已备案的 HTTPS 中继域名；留空时使用本地规则解析。

## 上传前的微信后台设置

- 添加插件「微信同声传译」，版本 `0.3.5`。
- 在「设置 → 服务内容声明 / 接口设置」申请 `wx.getLocation` 接口权限。
- `wx.request` 使用的中继域名必须是已 ICP 备案的 HTTPS 合法域名。
- 本项目没有调用 `wx.downloadFile`，因此图片不需要加入 downloadFile 合法域名；`<image>` 的外部 `src` 可直接使用。
- 当前详情数据实际出现的图片主机包括：
  - `store.is.autonavi.com`
  - `aos-cdn-image.amap.com`
  - `comment-oss-online.oss-cn-wulanchabu.aliyuncs.com`
  - `img.alicdn.com`
  - `aos-comment.amap.com`
  正式发布时按微信后台的图片域名规则检查并配置。
