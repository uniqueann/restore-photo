# restore-photo

独立老照片修复应用，复刻 `contentup/restore` 的卡密修复链路，只保留落地页和老照片修复处理页。

## 页面

- `/`：极简落地页
- `/restore`：卡密校验、图片上传、修复任务、结果预览、下载/分享

## 环境变量

`.env.local` 需要包含：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://gnrhyahjegvcicektebh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

DRAGONCODE_API_KEY=
DRAGONCODE_BASE_URL=https://dragoncode.codes/gpt-image/v1
DRAGONCODE_IMAGE_MODEL=gpt-image-2
DRAGONCODE_IMAGE_SIZE=1:1
DRAGONCODE_IMAGE_RESOLUTION=1k
DRAGONCODE_INITIAL_POLL_DELAY_MS=10000
DRAGONCODE_POLL_INTERVAL_MS=5000
DRAGONCODE_RESTORE_TIMEOUT_MS=300000
DRAGONCODE_REQUEST_TIMEOUT_MS=30000
DRAGONCODE_REQUEST_RETRY_COUNT=2
```

当前实现会复制 `content-up/.env.local` 中的 Supabase 配置。`DRAGONCODE_API_KEY` 如果为空，真实修复任务会返回明确的服务端错误。

## 数据依赖

继续使用 Supabase 项目 `gnrhyahjegvcicektebh` 中的：

- `public.card_keys`
- `public.restore_jobs`
- `storage.buckets`
- `storage.objects`

仅支持 `card_keys.style = 'restore'` 的卡密，不包含登录、用户额度、订阅或多工具入口。

## 本地运行

```bash
npm install
npm run dev
```

打开：

- `http://localhost:3000`
- `http://localhost:3000/restore`

## 验证

```bash
npm run lint
npm run build
```
