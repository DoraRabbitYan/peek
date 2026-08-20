#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const dist = path.resolve(root, "dist-extension");
const asset = path.join(root, "public", "assets", "tuzai-icon-source.png");

if (!dist.startsWith(root + path.sep)) throw new Error("Refusing to clean an output outside the project root");
if (!existsSync(source)) throw new Error("Missing extension source directory");
if (!existsSync(asset)) throw new Error("Missing icon source: public/assets/tuzai-icon-source.png");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(source, dist, { recursive: true });

const vendorDir = path.join(dist, "vendor", "phosphor");
mkdirSync(vendorDir, { recursive: true });

const hlsVendorDir = path.join(dist, "vendor", "hls");
const hlsSource = path.join(root, "node_modules", "hls.js", "dist", "hls.min.js");
const hlsWorkerSource = path.join(root, "node_modules", "hls.js", "dist", "hls.worker.js");
const hlsLicense = path.join(root, "node_modules", "hls.js", "LICENSE");
if (!existsSync(hlsSource) || !existsSync(hlsWorkerSource) || !existsSync(hlsLicense)) throw new Error("Missing local hls.js dependency");
mkdirSync(hlsVendorDir, { recursive: true });
cpSync(hlsSource, path.join(hlsVendorDir, "hls.min.js"));
cpSync(hlsWorkerSource, path.join(hlsVendorDir, "hls.worker.js"));
cpSync(hlsLicense, path.join(hlsVendorDir, "LICENSE"));

const iconSources = [
  path.join(source, "content.js"),
  path.join(source, "popup", "popup.html")
];
const iconNames = [...new Set(iconSources.flatMap((file) => {
  const contents = readFileSync(file, "utf8");
  return [
    ...[...contents.matchAll(/ph-([a-z0-9-]+)/g)].map((match) => match[1]),
    ...[...contents.matchAll(/data-phosphor-icon=["']([a-z0-9-]+)["']/g)].map((match) => match[1])
  ];
}))].sort();
const phosphorAssets = path.join(root, "node_modules", "@phosphor-icons", "core", "assets", "regular");
const iconPaths = Object.fromEntries(iconNames.map((name) => {
  const file = path.join(phosphorAssets, `${name}.svg`);
  if (!existsSync(file)) throw new Error(`Missing Phosphor icon: ${name}`);
  const svg = readFileSync(file, "utf8");
  const body = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i)?.[1]?.trim();
  if (!body) throw new Error(`Invalid Phosphor SVG: ${name}`);
  return [name, body];
}));
writeFileSync(
  path.join(vendorDir, "icons.js"),
  `globalThis.TuzaiPhosphorIcons = Object.freeze(${JSON.stringify(iconPaths)});\n`
);

const brandVendorDir = path.join(dist, "vendor", "brand");
const inlineBrandIcon = await sharp(asset).resize(48, 48, { fit: "cover" }).png().toBuffer();
mkdirSync(brandVendorDir, { recursive: true });
writeFileSync(
  path.join(brandVendorDir, "icon.js"),
  `globalThis.TuzaiBrandIconDataUrl = ${JSON.stringify(`data:image/png;base64,${inlineBrandIcon.toString("base64")}`)};\n`
);

const iconDir = path.join(dist, "icons");
mkdirSync(iconDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(asset).resize(size, size, { fit: "cover" }).png().toFile(path.join(iconDir, `icon${size}.png`));
}

console.log(`Built unpacked Chrome extension: ${dist}`);
