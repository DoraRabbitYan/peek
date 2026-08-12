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

const phosphorDir = path.join(root, "node_modules", "@phosphor-icons", "web", "src", "regular");
const vendorDir = path.join(dist, "vendor", "phosphor");
mkdirSync(vendorDir, { recursive: true });
cpSync(path.join(phosphorDir, "Phosphor.woff2"), path.join(vendorDir, "Phosphor.woff2"));
let phosphorCss = readFileSync(path.join(phosphorDir, "style.css"), "utf8");
phosphorCss = phosphorCss.replaceAll("./Phosphor.woff2", "./Phosphor.woff2");
writeFileSync(path.join(vendorDir, "style.css"), phosphorCss);

const iconDir = path.join(dist, "icons");
mkdirSync(iconDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(asset).resize(size, size, { fit: "cover" }).png().toFile(path.join(iconDir, `icon${size}.png`));
}

console.log(`Built unpacked Chrome extension: ${dist}`);
