#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const srcSvg = process.argv[2] ?? 'assets/logo.svg';
const outDir = process.argv[3] ?? 'assets/icons';
const linuxDir = path.join(outDir, 'linux');
const iconsetDir = path.join(outDir, 'icon.iconset');

const allPngSizes = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256, 512, 1024];
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256];
const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];

if (!fs.existsSync(srcSvg)) {
  console.error(`Error: source SVG not found: ${srcSvg}`);
  process.exit(1);
}

const checkCommand = (name) => {
  try {
    execFileSync('/bin/zsh', ['-lc', `command -v ${name}`], { stdio: 'ignore' });
  } catch {
    console.error(`Error: '${name}' is required but not installed.`);
    console.error('Install with: brew install librsvg');
    process.exit(1);
  }
};

checkCommand('rsvg-convert');

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(linuxDir, { recursive: true, force: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(linuxDir, { recursive: true });
fs.mkdirSync(iconsetDir, { recursive: true });

for (const size of allPngSizes) {
  const out = path.join(outDir, `icon_${size}x${size}.png`);
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), srcSvg, '-o', out], {
    stdio: 'inherit',
  });
}

// Canonical defaults used by builders and runtime.
fs.copyFileSync(path.join(outDir, 'icon_512x512.png'), path.join(outDir, 'icon.png'));
fs.copyFileSync(path.join(outDir, 'icon_16x16.png'), path.join(outDir, 'tray-icon.png'));
fs.copyFileSync(path.join(outDir, 'icon_32x32.png'), path.join(outDir, 'tray-icon@2x.png'));
fs.copyFileSync(path.join(outDir, 'icon_16x16.png'), path.join(outDir, 'tray-iconTemplate.png'));
fs.copyFileSync(path.join(outDir, 'icon_32x32.png'), path.join(outDir, 'tray-iconTemplate@2x.png'));

for (const size of allPngSizes) {
  fs.copyFileSync(
    path.join(outDir, `icon_${size}x${size}.png`),
    path.join(linuxDir, `${size}x${size}.png`),
  );
}

const makeIco = () => {
  const images = icoSizes.map((size) => {
    const file = path.join(outDir, `icon_${size}x${size}.png`);
    return {
      size,
      data: fs.readFileSync(file),
    };
  });

  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const chunks = [];

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ico
  header.writeUInt16LE(images.length, 4);
  chunks.push(header);

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    chunks.push(entry);
    offset += image.data.length;
  }

  for (const image of images) {
    chunks.push(image.data);
  }

  fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat(chunks));
};

const makeIcns = () => {
  const typeBySize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ]);

  const blocks = [];
  for (const size of icnsSizes) {
    const type = typeBySize.get(size);
    const data = fs.readFileSync(path.join(outDir, `icon_${size}x${size}.png`));
    const block = Buffer.alloc(8 + data.length);
    block.write(type, 0, 4, 'ascii');
    block.writeUInt32BE(8 + data.length, 4);
    data.copy(block, 8);
    blocks.push(block);
  }

  const totalSize = 8 + blocks.reduce((acc, b) => acc + b.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);

  fs.writeFileSync(path.join(outDir, 'icon.icns'), Buffer.concat([header, ...blocks]));
};

const makeIconset = () => {
  const mapping = new Map([
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]);

  for (const [name, size] of mapping.entries()) {
    fs.copyFileSync(path.join(outDir, `icon_${size}x${size}.png`), path.join(iconsetDir, name));
  }
};

makeIco();
makeIcns();
makeIconset();

console.log(`Generated desktop and tray icons from '${srcSvg}' into '${outDir}'`);
