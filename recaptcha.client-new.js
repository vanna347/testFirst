// plugins/recaptcha.client.js
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public
  const v3Key = config.recaptchaV3
  const v2Key = config.recaptchaV2
  const v2Only = config.v2Only === true || config.v2Only === 'true'

  // ------------- 共通：script ローダー（URL ごとに1回だけ）-------------
  const loadedScripts = new Set()

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (loadedScripts.has(url)) return resolve()

      const s = document.createElement("script")
      s.src = url
      s.async = true
      s.defer = true
      s.onload = () => {
        loadedScripts.add(url)
        resolve()
      }
      s.onerror = () => reject(new Error("Script load failed: " + url))
      document.head.appendChild(s)
    })
  }

  // grecaptcha が出現するまで待つ
  function waitForGrecaptcha(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const timer = setInterval(() => {
        if (window.grecaptcha) {
          clearInterval(timer)
          resolve(window.grecaptcha)
        } else if (Date.now() - start > timeout) {
          clearInterval(timer)
          reject(new Error("grecaptcha did not load"))
        }
      }, 50)
    })
  }

  // ----------------------------- v3 実行 -----------------------------
  async function executeV3(action = "login") {
    if (!v3Key) throw new Error("reCAPTCHA v3 key missing")

    await loadScript(`https://www.google.com/recaptcha/api.js?render=${v3Key}`)
    const grecaptcha = await waitForGrecaptcha()

    return new Promise((resolve, reject) => {
      grecaptcha.ready(() => {
        const p = grecaptcha.execute(v3Key, { action })
        if (p?.then) p.then(resolve).catch(reject)
        else reject(new Error("Failed to execute v3"))
      })
    })
  }

  // ----------------------------- v2 実行 -----------------------------
  async function renderV2(containerId = "recaptcha-container") {
    if (!v2Key) throw new Error("reCAPTCHA v2 key missing")

    // ★ v2 は "?render=explicit" を付けてはいけない
    await loadScript("https://www.google.com/recaptcha/api.js")

    const grecaptcha = await waitForGrecaptcha()

    // v2 ready 待ち（必須）
    await new Promise(r => grecaptcha.ready(r))

    return new Promise((resolve, reject) => {
      const container = document.getElementById(containerId)
      if (!container) return reject(new Error(`Missing container #${containerId}`))

      try {
        const widgetId = grecaptcha.render(containerId, {
          sitekey: v2Key,
          callback: (token) => resolve({ token, widgetId }),
          "error-callback": () => reject(new Error("v2 error"))
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  // ----------------------------- verify() -----------------------------
  async function verify(action = "login", containerId = "recaptcha-container") {
    // v2 Only モード
    if (v2Only) {
      console.log("[recaptcha] v2Only mode")
      const r = await renderV2(containerId)
      return { token: r.token, version: "v2" }
    }

    // ① v3
    try {
      console.log("[recaptcha] try v3")
      const token = await executeV3(action)
      console.log("[recaptcha] v3 success")
      return { token, version: "v3" }
    } catch (e) {
      console.warn("[recaptcha] v3 failed, fallback to v2:", e)
    }

    // ② v2 フォールバック
    const r = await renderV2(containerId)
    console.log("[recaptcha] v2 success after fallback")
    return { token: r.token, version: "v2" }
  }

  // provide
  nuxtApp.provide("recaptcha", { verify, executeV3, renderV2 })
})
