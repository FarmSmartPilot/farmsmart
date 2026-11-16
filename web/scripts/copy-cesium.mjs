// Copy Cesium's prebuilt runtime (Cesium.js, Workers, Assets, Widgets, ThirdParty)
// into web/public/cesium so it is served at /cesium. Runs on predev/prebuild.
// Skips the copy when the version stamp already matches. Cross-platform (Node fs only).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(webRoot, 'node_modules', 'cesium', 'Build', 'Cesium')
const dst = join(webRoot, 'public', 'cesium')
const pkg = JSON.parse(readFileSync(join(webRoot, 'node_modules', 'cesium', 'package.json'), 'utf8'))
const stampFile = join(dst, '.version')

if (existsSync(stampFile) && readFileSync(stampFile, 'utf8').trim() === pkg.version) {
  console.log(`[copy-cesium] public/cesium already at ${pkg.version}`)
  process.exit(0)
}
if (!existsSync(src)) {
  console.error(`[copy-cesium] missing ${src}; run npm install`)
  process.exit(1)
}
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const item of ['Workers', 'Assets', 'Widgets', 'ThirdParty', 'Cesium.js']) {
  cpSync(join(src, item), join(dst, item), { recursive: true })
}
writeFileSync(stampFile, pkg.version)
console.log(`[copy-cesium] copied Cesium ${pkg.version} to public/cesium`)
