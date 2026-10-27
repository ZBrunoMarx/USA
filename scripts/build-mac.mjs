// Builds a local Mac bundle from an allowlist; never copies credentials or data.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(root, '.local'), { recursive: true });
const staging = mkdtempSync(join(root, '.local/mac-build-'));
try {
  for (const name of ['package.json', 'package-lock.json', 'server.mjs', 'auth.mjs', 'vision.mjs', 'reports.mjs']) copyFileSync(join(root, name), join(staging, name));
  mkdirSync(join(staging, 'public'));
  for (const entry of readdirSync(join(root, 'public'), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Link no diretório público precisa de revisão: ' + entry.name);
    if (!entry.isFile()) continue;
    if (!/\.(js|css|html|svg|webmanifest)$/.test(entry.name)) throw new Error('Arquivo público precisa de revisão: ' + entry.name);
    const source = join(entry.parentPath, entry.name), targetFile = join(staging, 'public', relative(join(root, 'public'), source));
    mkdirSync(join(targetFile, '..'), { recursive: true });
    copyFileSync(source, targetFile);
  }
  mkdirSync(join(staging, 'scripts'));
  for (const name of ['start-local.mjs', 'test-live-vision.mjs']) copyFileSync(join(root, 'scripts', name), join(staging, 'scripts', name));
  copyFileSync(join(root, 'deploy/mac/COMECE-AQUI.md'), join(staging, 'COMECE-AQUI.md'));
  copyFileSync(join(root, 'deploy/mac/Iniciar Skytile.command'), join(staging, 'Iniciar Skytile.command'));
  chmodSync(join(staging, 'Iniciar Skytile.command'), 0o755);
  const target = join(root, '.local/mac-package');
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  console.log('Pacote Mac preparado em .local/mac-package, sem dados ou credenciais.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
