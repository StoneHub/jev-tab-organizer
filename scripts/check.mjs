import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const manifest = JSON.parse(await readFile('extension/manifest.json','utf8'));
if (manifest.manifest_version !== 3 || manifest.host_permissions || manifest.content_scripts) throw new Error('Unexpected manifest permissions');
for (const file of await readdir('extension')) {
  if (file.endsWith('.js')) { const result = spawnSync(process.execPath, ['--check',`extension/${file}`], {stdio:'inherit'}); if (result.status !== 0) process.exit(1); }
}
await readFile(`extension/${manifest.background.service_worker}`);
for (const asset of ['dashboard.js','dashboard.html','core.js','styles.css']) await readFile(`extension/${asset}`);
console.log('MV3 manifest, required assets and extension JavaScript syntax verified.');
