import type { SvgShape } from './svg-to-vector.js'
import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { rootDir } from './config.js'
import { ensureDir, ensureGitExclude, step } from './lib.js'
import {
  fmtNum,
  parseSvgBody,
  resolveFillColor,
  resolveStrokeColor,

} from './svg-to-vector.js'

const ADAPTIVE_SIZE = 108
const FG_SAFE = 72
const FG_INSET = (ADAPTIVE_SIZE - FG_SAFE) / 2
const BG_GRADIENT_FROM = '#FFD4A3FF'
const BG_GRADIENT_TO = '#FFD59EFF'

function shapeToPathXml(shape: SvgShape, monochrome: boolean): string | null {
  const fill = resolveFillColor(shape.fill)
  const stroke = resolveStrokeColor(shape.stroke)
  if (!fill && !stroke) return null
  const attrs: string[] = [`android:pathData="${shape.d}"`]
  if (fill) attrs.push(`android:fillColor="${monochrome ? '#FFFFFFFF' : fill}"`)
  if (stroke) {
    attrs.push(`android:strokeColor="${monochrome ? '#FFFFFFFF' : stroke}"`)
    attrs.push(`android:strokeWidth="${fmtNum(Number(shape.strokeWidth ?? 1))}"`)
    if (shape.strokeLineCap) attrs.push(`android:strokeLineCap="${shape.strokeLineCap}"`)
    if (shape.strokeLineJoin) attrs.push(`android:strokeLineJoin="${shape.strokeLineJoin}"`)
  }
  return `        <path\n            ${attrs.join('\n            ')} />`
}

function buildForegroundVector(shapes: SvgShape[], srcW: number, srcH: number, monochrome: boolean): string {
  const scale = FG_SAFE / Math.max(srcW, srcH)
  const offsetX = FG_INSET + (FG_SAFE - srcW * scale) / 2
  const offsetY = FG_INSET + (FG_SAFE - srcH * scale) / 2
  const paths = shapes
    .map(s => shapeToPathXml(s, monochrome))
    .filter((s): s is string => s !== null)
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${ADAPTIVE_SIZE}dp"
    android:height="${ADAPTIVE_SIZE}dp"
    android:viewportWidth="${ADAPTIVE_SIZE}"
    android:viewportHeight="${ADAPTIVE_SIZE}">
    <group
        android:translateX="${fmtNum(offsetX)}"
        android:translateY="${fmtNum(offsetY)}"
        android:scaleX="${fmtNum(scale)}"
        android:scaleY="${fmtNum(scale)}">
${paths.join('\n')}
    </group>
</vector>
`
}

function buildBackgroundVector(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${ADAPTIVE_SIZE}dp"
    android:height="${ADAPTIVE_SIZE}dp"
    android:viewportWidth="${ADAPTIVE_SIZE}"
    android:viewportHeight="${ADAPTIVE_SIZE}">
    <path android:pathData="M0,0h${ADAPTIVE_SIZE}v${ADAPTIVE_SIZE}h-${ADAPTIVE_SIZE}z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="0"
                android:startY="0"
                android:endX="0"
                android:endY="${ADAPTIVE_SIZE}">
                <item android:offset="0" android:color="${BG_GRADIENT_FROM}" />
                <item android:offset="1" android:color="${BG_GRADIENT_TO}" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
`
}

async function writeGenerated(repoDir: string, relPath: string, content: string): Promise<boolean> {
  const absPath = join(repoDir, 'TMessagesProj/src/main/res', relPath)
  await ensureDir(dirname(absPath))
  const stat = await fs.lstat(absPath).catch(() => null)
  if (stat?.isSymbolicLink()) await fs.unlink(absPath)
  const current = stat?.isFile() ? await fs.readFile(absPath, 'utf8').catch(() => null) : null
  let dirty = false
  if (current !== content) {
    step(`Generating ${relPath}`)
    await fs.writeFile(absPath, content)
    dirty = true
  }
  await ensureGitExclude(repoDir, `TMessagesProj/src/main/res/${relPath}`)
  return dirty
}

async function loadSvg(relPath: string): Promise<{ shapes: SvgShape[], srcW: number, srcH: number }> {
  const svgPath = join(rootDir, relPath)
  const svg = await fs.readFile(svgPath, 'utf8')
  const viewBox = svg.match(/viewBox\s*=\s*"\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/)
  if (!viewBox) throw new Error(`${relPath} missing viewBox starting at 0 0`)
  return { shapes: parseSvgBody(svg), srcW: Number(viewBox[1]), srcH: Number(viewBox[2]) }
}

export async function generateLauncherIcon(repoDir: string): Promise<boolean> {
  const fg = await loadSvg('src/res/launcher/icon.svg')
  const mono = await loadSvg('src/res/launcher/icon-mono.svg')

  const foreground = buildForegroundVector(fg.shapes, fg.srcW, fg.srcH, false)
  const monochrome = buildForegroundVector(mono.shapes, mono.srcW, mono.srcH, true)
  const background = buildBackgroundVector()

  // wired into stock @mipmap/ic_launcher{,_round} by feature__app-icon
  const targets: [string, string][] = [
    ['drawable/icon_background_inu.xml', background],
    ['drawable/icon_plane_inu.xml', monochrome],
    ['drawable/icon_foreground_inu.xml', foreground],
    ['drawable/icon_foreground_inu_round.xml', foreground],
  ]

  let dirty = false
  for (const [rel, content] of targets) {
    if (await writeGenerated(repoDir, rel, content)) dirty = true
  }
  return dirty
}
