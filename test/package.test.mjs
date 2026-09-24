import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('repackaging removes deleted source files from staging and the ZIP', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-package-test-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'extension'));
    await copyFile(new URL('../scripts/package.mjs', import.meta.url), path.join(root, 'scripts/package.mjs'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({version:'0.1.0', type:'module'}));
    await writeFile(path.join(root, 'extension/keep.txt'), 'current');
    await writeFile(path.join(root, 'extension/removed.txt'), 'obsolete');
    const pack = () => execFileSync(process.execPath, ['scripts/package.mjs'], {cwd:root});
    const entries = () => execFileSync('unzip', ['-Z1', 'dist/jev-tab-organizer-0.1.0-unpacked.zip'], {cwd:root, encoding:'utf8'});
    pack();
    assert.match(entries(), /removed\.txt/);
    await rm(path.join(root, 'extension/removed.txt'));
    pack();
    assert.doesNotMatch(entries(), /removed\.txt/);
    assert.match(entries(), /keep\.txt/);
    // An obsolete entry in the ZIP alone must also disappear on the next build.
    await writeFile(path.join(root, 'archive-only.txt'), 'obsolete archive entry');
    execFileSync('zip', ['-q', 'dist/jev-tab-organizer-0.1.0-unpacked.zip', 'archive-only.txt'], {cwd:root});
    pack();
    assert.doesNotMatch(entries(), /archive-only\.txt/);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});
