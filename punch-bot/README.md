# 打卡提醒機器人（Apollo × Telegram）

跑在 Cloudflare Workers 上的 Telegram 機器人。上班時間 09:00～18:00，每個上班日：

| 台北時間 | 動作 |
|---|---|
| 08:50 | 傳「打上班卡」提醒（附按鈕） |
| 08:57 | 還沒打卡就再提醒一次 |
| 18:00 | 傳「打下班卡」提醒（附按鈕） |
| 18:10 | 還沒打卡就再提醒一次 |

**點按鈕才會呼叫 Apollo 打卡**，沒點就不會打。按鈕只在當天有效。

- 國定假日、補假、補班日：依行政院人事行政總處公布的「政府行政機關辦公日曆表」
  （透過 [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar) 取得，快取 7 天）。
  抓不到資料時退回「週一到週五上班」，並在提醒中標示。
- 請假：用 Telegram 指令登記，請假日不提醒。

## 指令

| 指令 | 說明 |
|---|---|
| `/today` | 今天是否上班、打卡狀態 |
| `/in`、`/out` | 立即打上班／下班卡 |
| `/leave 11/20` | 登記請假，可給區間：`/leave 11/20 11/22` |
| `/cancel 11/20` | 取消請假（可給區間） |
| `/leaves` | 列出已登記的請假 |

## 部署步驟

```bash
cd punch-bot
npx wrangler login
npx wrangler kv namespace create punch-bot   # 把產生的 id 填進 wrangler.toml
```

1. 在 Telegram 找 **@BotFather** → `/newbot` 取得 bot token。
2. 設定 secrets：

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # 自訂一串隨機英數字
   ```

3. 部署並設定 webhook：

   ```bash
   npx wrangler deploy
   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy ./scripts/set-webhook.sh https://punch-bot.<子網域>.workers.dev
   ```

4. 在 Telegram 傳 `/start` 給你的機器人，它會回覆你的 chat id。設定後重新部署：

   ```bash
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```

   之後機器人只回應這個 chat，其他人傳訊息一律忽略。

## 接上 Apollo

`wrangler.toml` 裡的 `APOLLO_DRY_RUN = "true"` 是**模擬模式**：按鈕和流程都正常，但不會真的打卡，
回覆訊息會標示「模擬模式」。

Apollo 沒有公開 API，要真的打卡需要：

1. 用 Charles／Proxyman／mitmproxy 側錄 Apollo App 的「登入」和「打卡」請求。
2. 依側錄結果實作 `src/apollo.js` 的 `realPunch()`。
3. 用 `wrangler secret put` 設定帳號密碼，把 `APOLLO_DRY_RUN` 改成 `"false"` 後重新部署。

注意：用非官方方式呼叫 Apollo 可能違反其使用條款，App 改版時也可能失效（失效時會在 Telegram 回報錯誤）。

## 開發

```bash
npm test          # 單元測試（Node 22，不需安裝套件）
npx wrangler dev --test-scheduled   # 本機測試，可用 /__scheduled?cron=50+0+*+*+* 觸發排程
```
