// Telegram Bot API 小工具

export async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method} 失敗：${data.description || res.status}`);
  return data.result;
}

export function sendMessage(env, text, extra = {}) {
  return tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text, ...extra });
}

export function punchButton(type, date) {
  const label = type === 'in' ? '✅ 打上班卡' : '✅ 打下班卡';
  return { inline_keyboard: [[{ text: label, callback_data: `p:${type}:${date}` }]] };
}
