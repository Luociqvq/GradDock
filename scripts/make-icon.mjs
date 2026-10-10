/**
 * 生成 build/icon.png（1024x1024，圆角外透明）。
 * 和渲染层 drawTrayIcon 用的是同一套形状与配色，改品牌色时两边一起改。
 * 用法：node scripts/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const SIZE = 1024
const RADIUS = Math.round(SIZE * 0.17)
const FROM = [99, 102, 241]
const TO = [168, 85, 247]
const CHECK = [
  [0.30, 0.54],
  [0.44, 0.68],
  [0.71, 0.33]
]
const STROKE = 0.085

function roundedMask(x, y) {
  const inset = RADIUS
  const cx = Math.min(Math.max(x, inset), SIZE - inset)
  const cy = Math.min(Math.max(y, inset), SIZE - inset)
  return Math.hypot(x - cx, y - cy) <= RADIUS
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const len = vx * vx + vy * vy
  let t = len ? ((px - ax) * vx + (py - ay) * vy) / len : 0
  t = Math.min(1, Math.max(0, t))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

/** 笔画端点是圆的，所以到折线的距离小于半个笔宽即命中。 */
function checkMask(x, y) {
  const half = (STROKE * SIZE) / 2
  for (let i = 0; i < CHECK.length - 1; i += 1) {
    const [ax, ay] = CHECK[i]
    const [bx, by] = CHECK[i + 1]
    if (distToSegment(x, y, ax * SIZE, ay * SIZE, bx * SIZE, by * SIZE) <= half) return true
  }
  return false
}

const png = new PNG({ width: SIZE, height: SIZE })
const samples = 3
const step = 1 / samples

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let inside = 0
    let ink = 0
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const x = px + sx * step
        const y = py + sy * step
        if (!roundedMask(x, y)) continue
        inside += 1
        if (checkMask(x, y)) ink += 1
      }
    }
    const alpha = Math.round((inside / (samples * samples)) * 255)
    // 对角渐变：左上 indigo，右下 purple
    const t = (px + py) / (2 * SIZE)
    const mix = (channel) => Math.round(FROM[channel] + (TO[channel] - FROM[channel]) * t)
    const white = ink / (samples * samples)
    const offset = (py * SIZE + px) * 4
    png.data[offset] = Math.round(mix(0) + (255 - mix(0)) * white)
    png.data[offset + 1] = Math.round(mix(1) + (255 - mix(1)) * white)
    png.data[offset + 2] = Math.round(mix(2) + (255 - mix(2)) * white)
    png.data[offset + 3] = alpha
  }
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, PNG.sync.write(png))
console.log(`wrote ${out} (${SIZE}x${SIZE})`)
