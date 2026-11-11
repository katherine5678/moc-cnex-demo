// Apollo（Mayo）打卡介面
//
// Apollo 沒有公開 API，實際的登入／打卡請求需要從 App 側錄後填入 realPunch()。
// 在填好之前，預設為 APOLLO_DRY_RUN=true：只模擬成功，不會真的打卡，
// 方便先測試 Telegram 提醒、按鈕、假日與請假流程。

/**
 * @param {object} env
 * @param {'in'|'out'} type
 * @returns {Promise<{ ok: true, dryRun: boolean, detail?: string }>}
 * 失敗時請丟出 Error（訊息會轉傳到 Telegram）
 */
export async function punch(env, type) {
  if (env.APOLLO_DRY_RUN !== 'false') {
    return { ok: true, dryRun: true, detail: '模擬模式，未實際送出' };
  }
  return realPunch(env, type);
}

// eslint-disable-next-line no-unused-vars
async function realPunch(env, type) {
  // TODO：依側錄結果實作，大致流程：
  //   1. 用 env.APOLLO_USERNAME / env.APOLLO_PASSWORD（或 env.APOLLO_TOKEN）登入取得 token
  //   2. 呼叫打卡 API，type === 'in' 為上班、'out' 為下班
  //   3. 檢查回應是否成功，不成功就 throw new Error('原因')
  throw new Error(
    'Apollo 打卡 API 尚未實作：請提供 App 打卡的側錄請求，或暫時把 APOLLO_DRY_RUN 設回 true',
  );
}
