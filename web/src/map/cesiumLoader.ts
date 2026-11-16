// Lazy loader for CesiumJS. The prebuilt runtime is copied to /cesium by
// scripts/copy-cesium.mjs and fetched only when a globe is mounted, so the main
// bundle stays small and Vite never has to bundle Cesium.
import type * as CesiumNS from 'cesium'

export type Cesium = typeof CesiumNS

declare global {
  interface Window {
    CESIUM_BASE_URL?: string
    Cesium?: Cesium
  }
}

let loading: Promise<Cesium> | null = null

export function cesiumBaseUrl(): string {
  return `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/cesium`
}

export function loadCesium(timeoutMs = 20000): Promise<Cesium> {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (loading) return loading
  const baseUrl = cesiumBaseUrl()
  window.CESIUM_BASE_URL = baseUrl
  loading = new Promise<Cesium>((resolve, reject) => {
    if (!document.querySelector('link[data-cesium-widgets]')) {
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${baseUrl}/Widgets/widgets.css`
      css.dataset.cesiumWidgets = '1'
      document.head.appendChild(css)
    }
    const s = document.createElement('script')
    s.src = `${baseUrl}/Cesium.js`
    s.async = true
    const timer = window.setTimeout(() => reject(new Error('Cesium load timed out')), timeoutMs)
    s.onload = () => {
      window.clearTimeout(timer)
      const C = window.Cesium
      if (!C) return reject(new Error('Cesium global missing'))
      const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined
      // Without a token nothing may call Cesium ion: we pass our own imagery and ellipsoid terrain.
      C.Ion.defaultAccessToken = token || ''
      resolve(C)
    }
    s.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('Cesium script failed to load'))
    }
    document.head.appendChild(s)
  }).catch((e) => {
    loading = null
    throw e
  })
  return loading
}

export const hasIonToken = () => !!(import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)
