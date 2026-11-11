// Cloudflare Worker 入口

import { handleUpdate, runSchedule } from './bot.js';
import { sendMessage } from './telegram.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/telegram') {
      // Telegram 會在每次呼叫時帶上 setWebhook 設定的 secret_token
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json();
      try {
        await handleUpdate(env, update);
      } catch (err) {
        console.error(err);
      }
      // 一律回 200，避免 Telegram 重送同一個 update
      return new Response('ok');
    }

    return new Response('punch-bot is running');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runSchedule(env, event.cron).catch(async (err) => {
        console.error(err);
        await sendMessage(env, `⚠️ 打卡提醒排程出錯：${err.message}`).catch(() => {});
      }),
    );
  },
};
