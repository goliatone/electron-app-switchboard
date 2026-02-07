#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const srcSvg = process.argv[2] ?? 'assets/logo_white.svg';
const outDir = process.argv[3] ?? 'assets/icons';
const scale = Number(process.argv[4] ?? 0.72);
const cornerRatio = Number(process.argv[5] ?? 0.24);

if (!fs.existsSync(srcSvg)) {
  console.error(`Error: source SVG not found: ${srcSvg}`);
  process.exit(1);
}

const source = fs.readFileSync(srcSvg, 'utf8');
const viewBoxMatch = source.match(/viewBox\s*=\s*"([^"]+)"/i);
const values = viewBoxMatch?.[1].trim().split(/\s+/).map(Number);
if (!values || values.length !== 4 || values.some((v) => Number.isNaN(v))) {
  console.error('Error: source SVG must include a valid viewBox="minX minY width height".');
  process.exit(1);
}

const [minX, minY, width, height] = values;
const radius = Math.min(width, height) * cornerRatio;

const inner = source
  .replace(/^[\s\S]*?<svg[^>]*>/i, '')
  .replace(/<\/svg>\s*$/i, '');

// Force any filled content in the source icon to white for contrast on black.
const whiteInner = inner.replace(/fill="[^"]*"/gi, 'fill="#ffffff"');

const centerX = minX + width / 2;
const centerY = minY + height / 2;
const tx = centerX - centerX * scale;
const ty = centerY - centerY * scale;

const composed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}">
  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#000000"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">${whiteInner}</g>
</svg>
`;

const tmpSvg = path.join(os.tmpdir(), `switchboard-mac-squircle-${Date.now()}.svg`);
fs.writeFileSync(tmpSvg, composed);

try {
  execFileSync(process.execPath, ['scripts/generate-icons.mjs', tmpSvg, outDir], { stdio: 'inherit' });
} finally {
  fs.rmSync(tmpSvg, { force: true });
}

console.log(`Generated mac squircle icon set from '${srcSvg}' into '${outDir}'`);
