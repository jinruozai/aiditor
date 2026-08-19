// Verify AI chat composer actions row at narrow widths.
// Usage: node tools/verify-chat-actions.cjs [outDir] [widths...]
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const outDir = process.argv[2] || '/tmp/aiditor-chat'
const widths = (process.argv[3] || '560,500,440').split(',').map(Number)

;(async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 720 } })
    await page.goto('http://localhost:5570/index.html', { waitUntil: 'networkidle' })
    // Wait for the AI chat composer to be mounted and agent selected.
    await page.waitForSelector('.aiditor-ai-composer', { timeout: 10000 })
    await page.waitForTimeout(600)
    const composer = page.locator('.aiditor-ai-composer').first()
    await composer.screenshot({ path: path.join(outDir, `composer-${width}.png`) })
    // Report geometry: bounding boxes of left/right groups + any overlap.
    const geo = await page.evaluate(() => {
      const q = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }
      }
      const left = q('.aiditor-ai-chat-actions-left')
      const right = q('.aiditor-ai-chat-actions-right')
      const overlap = left && right ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.x, right.x)) : null
      return { left, right, overlap }
    })
    console.log(width + 'px =>', JSON.stringify(geo))
    await page.close()
  }
  await browser.close()
})().catch(function (err) { console.error(err); process.exit(1) })
