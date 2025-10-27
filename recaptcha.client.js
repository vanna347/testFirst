// plugins/recaptcha.client.js
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public
  const v3Key = config.recaptchaV3
  const v2Key = config.recaptchaV2
  const v2Only = config.v2Only === true || config.v2Only === 'true'

  // スクリプトを1回だけロード（Promise をキャッシュ）
  let loadPromise = null
  function loadScript(url) {
    if (loadPromise) return loadPromise
    loadPromise = new Promise((resolve, reject) => {
      // 既に同じ src がある場合は onload を待つ
      const existing = document.querySelector(`script[src="${url}"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('Script load failed')))
        return
      }
      const s = document.createElement('script')
      s.src = url
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Script load failed'))
      document.head.appendChild(s)
    })
    return loadPromise
  }

  // grecaptcha が ready になるのを待つ
  function waitForGrecaptcha(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const check = () => {
        if (window.grecaptcha) return resolve(window.grecaptcha)
        if (Date.now() - start > timeoutMs) return reject(new Error('grecaptcha did not load'))
        setTimeout(check, 100)
      }
      check()
    })
  }

  // v3 実行
  async function executeV3(action = 'login') {
    if (!v3Key) throw new Error('reCAPTCHA v3 site key not set')
    await loadScript(`https://www.google.com/recaptcha/api.js?render=${v3Key}`)
    const grecaptcha = await waitForGrecaptcha()
    return new Promise((resolve, reject) => {
      try {
        grecaptcha.ready(() => {
          // grecaptcha.execute returns Promise in some builds, but to be safe handle callback:
          const p = grecaptcha.execute(v3Key, { action })
          if (p && typeof p.then === 'function') {
            p.then((token) => resolve(token)).catch(reject)
          } else {
            // fallback: try to get token via callback (older APIs)
            setTimeout(() => {
              if (window.grecaptcha && window.grecaptcha.getResponse) {
                resolve(window.grecaptcha.getResponse())
              } else {
                reject(new Error('reCAPTCHA v3 execute returned no token'))
              }
            }, 500)
          }
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  // v2 を containerId に render して、callback で token を返す
  async function renderV2(containerId = 'recaptcha-container') {
    if (!v2Key) throw new Error('reCAPTCHA v2 site key not set')
    await loadScript('https://www.google.com/recaptcha/api.js?render=explicit')
    const grecaptcha = await waitForGrecaptcha()
    return new Promise((resolve, reject) => {
      // container が存在するか確認
      const container = document.getElementById(containerId)
      if (!container) {
        reject(new Error(`Container #${containerId} not found`))
        return
      }
      try {
        const widgetId = grecaptcha.render(containerId, {
          sitekey: v2Key,
          callback: (token) => {
            resolve({ token, widgetId })
          },
          'error-callback': () => reject(new Error('reCAPTCHA v2 error')),
        })
        // widgetId は必要なら返す
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * verify()
   * - v2Only が true のときは v2 を描画してトークンを得る
   * - それ以外は v3 を試し、失敗したら v2 にフォールバック
   * 戻り値: { token: string, version: 'v3'|'v2' }
   */
  async function verify(action = 'login', containerId = 'recaptcha-container') {
    if (v2Only) {
      console.log('[recaptcha] v2Only mode: render v2')
      const r = await renderV2(containerId)
      console.log('[recaptcha] v2 token received')
      return { token: r.token, version: 'v2' }
    }

    // try v3
    try {
      console.log('[recaptcha] trying v3')
      const token = await executeV3(action)
      console.log('[recaptcha] v3 success')
      return { token, version: 'v3' }
    } catch (err) {
      console.warn('[recaptcha] v3 failed, fallback to v2:', err)
      const r = await renderV2(containerId)
      console.log('[recaptcha] v2 success after fallback')
      return { token: r.token, version: 'v2' }
    }
  }

  // provide($recaptcha)
  nuxtApp.provide('recaptcha', { verify, executeV3, renderV2 })
})
