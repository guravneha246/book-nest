import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const LITESTREAM_VERSION = 'v0.3.13';
const BIN_DIR = path.resolve(process.cwd(), 'bin');
const targetBinary = path.join(BIN_DIR, 'litestream');

export async function installLitestream() {
  if (process.platform !== 'linux') {
    console.log(`[Litestream Notice] Platform is ${process.platform}. Litestream replication binary is provided for Linux cloud deployment.`);
    return null;
  }

  if (fs.existsSync(targetBinary)) {
    try {
      const version = execSync(`"${targetBinary}" version`, { encoding: 'utf-8' }).trim();
      console.log(`[Litestream] Found existing installation: ${version}`);
      return targetBinary;
    } catch {
      // Re-download if existing binary is corrupt
    }
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const assetName = `litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz`;
  const downloadUrl = `https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/${assetName}`;
  const archivePath = path.join(BIN_DIR, assetName);

  console.log(`[Litestream] Downloading ${LITESTREAM_VERSION} for Linux (${arch})...`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Litestream from ${downloadUrl}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(archivePath, Buffer.from(arrayBuffer));

  console.log(`[Litestream] Extracting archive...`);
  execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'inherit' });

  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath);
  }

  if (fs.existsSync(targetBinary)) {
    fs.chmodSync(targetBinary, 0o755);
  }

  const installedVersion = execSync(`"${targetBinary}" version`, { encoding: 'utf-8' }).trim();
  console.log(`[Litestream] Successfully installed: ${installedVersion}`);
  return targetBinary;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  installLitestream().catch((err) => {
    console.error('[Litestream Install Error]:', err.message);
    process.exit(1);
  });
}
