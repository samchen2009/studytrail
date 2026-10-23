'use strict';
// Offline installer regression tests: exercise the real installer against tiny archives.
// No user runtime, application directory or personal data is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
if (process.platform !== 'darwin') {
  console.log('macOS installer tests skipped on this platform.');
  process.exit(0);
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studytrail-install-test-')));
const installer = path.resolve(__dirname, '../scripts/install.sh');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function write(file, text, executable = false) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, text);
  if (executable) fs.chmodSync(file, 0o755);
}
function run(command, args, env = {}, cwd, input) {
  const result = spawnSync(command, args, {encoding:'utf8', env:{...process.env, ...env}, cwd, input});
  if (result.error) throw result.error;
  return result;
}
function ok(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
try {
  const fixtures = path.join(root, 'fixtures');
  const mockBin = path.join(root, 'mock-bin');
  const record = path.join(root, 'downloads');
  const tandemRecord = path.join(root, 'tandix-runs');
  const cliRecord = path.join(root, 'codex-runs');
  const fakeCodex = `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(cliRecord)},JSON.stringify(args)+'\\n');
if(args[0]==='login'&&args[1]==='status')process.exit(process.env.STUDYTRAIL_TEST_FAIL_LOGIN?1:0);
if(args[0]==='login'&&process.env.STUDYTRAIL_TEST_FAIL_LOGIN)process.exit(9);
if(args[0]==='--version')console.log('Codex test fixture');
`;
  const env = {PATH: mockBin + path.delimiter + process.env.PATH};
  write(path.join(mockBin, 'codex'), fakeCodex, true);
  write(path.join(mockBin, 'open'), '#!/bin/bash\nif [ "$1" = -Ra ] && [ "${STUDYTRAIL_TEST_MISSING_CHROME:-0}" = 1 ]; then exit 1; fi\n', true);
  // Use the real Node executable via a tiny wrapper, with a stub npm CLI.
  write(path.join(fixtures, 'node/bin/node'), '#!/bin/bash\nexec ' + quote(process.execPath) + ' "$@"\n', true);
  write(path.join(fixtures, 'node/lib/node_modules/npm/bin/npm-cli.js'), `
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='ci') {
 if(process.env.STUDYTRAIL_TEST_FAIL_NPM) process.exit(7);
 fs.writeFileSync('npm-installed.json',JSON.stringify(args));
} else if(args[0]==='install'&&args.at(-1)==='@openai/codex') {
 const path=require('node:path'),prefix=args[args.indexOf('--prefix')+1];
 fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});
 fs.writeFileSync(path.join(prefix,'bin/codex'),${JSON.stringify(fakeCodex)},{mode:0o755});
} else {throw Error('Unexpected npm invocation: '+args);}
`);
  write(path.join(fixtures, 'runtime-discovery.mjs'), `export function findCodex(){return process.env.STUDYTRAIL_TEST_MISSING_CODEX?'':${JSON.stringify(path.join(mockBin,'codex'))}}`);
  write(path.join(fixtures, 'tandix-macos.sh'), `#!/bin/bash
set -euo pipefail
node -e 'require("node:fs").appendFileSync(${JSON.stringify(tandemRecord)},JSON.stringify({path:process.env.PATH,codex:process.env.CODEX_CLI_PATH})+"\\n")'
if [ "\${STUDYTRAIL_TEST_FAIL_TANDIX:-0}" = 1 ]; then exit 8; fi
if [ "\${STUDYTRAIL_TEST_READ_STDIN:-0}" = 1 ]; then read -r answer; [ "$answer" = extension-confirmed ]; fi
`);
  write(path.join(fixtures, 'studytrail-main/package-lock.json'), '{}');
  write(path.join(fixtures, 'studytrail-main/scripts/dev.cjs'), `
const fs=require('node:fs'),path=require('node:path');
const i=process.argv.indexOf('--data-dir');
fs.mkdirSync(process.argv[i+1],{recursive:true});
fs.writeFileSync(path.join(process.argv[i+1],'started.json'),JSON.stringify(process.argv.slice(2)));
`);
  ok(run('tar', ['-czf', path.join(fixtures, 'node.tar.gz'), '-C', fixtures, 'node']));
  ok(run('/usr/bin/zip', ['-qr', path.join(fixtures, 'project.zip'), 'studytrail-main'], {}, fixtures));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(fixtures, 'node.tar.gz'))).digest('hex');
  write(path.join(mockBin, 'curl'), '#!/bin/bash\nexec ' + quote(process.execPath) + ' ' + quote(path.join(mockBin, 'curl.cjs')) + ' "$@"\n', true);
  write(path.join(mockBin, 'curl.cjs'), `
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),url=args.at(-1),dest=args[args.indexOf('--output')+1];
fs.appendFileSync(${JSON.stringify(record)},url+'\\n');
const fixture=${JSON.stringify(fixtures)};
if(url==='https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt') {
 const hash=process.env.STUDYTRAIL_TEST_BAD_HASH?'0'.repeat(64):${JSON.stringify(hash)};
 fs.writeFileSync(dest,['arm64','x64'].map(a=>hash+'  node-v24.0.0-darwin-'+a+'.tar.gz').join('\\n')+'\\n');
} else if(/^https:\\/\\/nodejs.org\\/dist\\/v24.0.0\\/node-v24.0.0-darwin-(arm64|x64)\\.tar\\.gz$/.test(url)) {
 fs.copyFileSync(path.join(fixture,'node.tar.gz'),dest);
} else if(url==='https://github.com/samchen2009/studytrail/archive/refs/heads/main.zip') {
 fs.copyFileSync(path.join(fixture,'project.zip'),dest);
} else if(url==='https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/runtime/runtime-discovery.mjs') {
 fs.copyFileSync(path.join(fixture,'runtime-discovery.mjs'),dest);
} else if(url==='https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/install/macos.sh') {
 fs.copyFileSync(path.join(fixture,'tandix-macos.sh'),dest);
} else { console.error('Unexpected URL: '+url);process.exit(22); }
`);
  const target = path.join(root, "parent with spaces 学迹/Study'Trail");
  ok(run('/bin/bash', [installer, '--install-dir', target, '--no-start'], env));
  assert.ok(fs.existsSync(path.join(target, '.studytrail-installer-v1')));
  assert.ok(fs.existsSync(path.join(target, '.tandix-setup-v1')), 'default installation must invoke Tandix');
  const tandem = JSON.parse(fs.readFileSync(tandemRecord, 'utf8').trim());
  assert.equal(tandem.path.split(path.delimiter)[0], path.join(target,'runtime/bin'), 'official wizard must receive permanent Node path');
  assert.equal(tandem.codex, path.join(mockBin,'codex'), 'existing Codex must be reused');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'app/npm-installed.json'))), ['ci','--include=optional','--ignore-scripts','--no-audit','--no-fund']);
  assert.equal(fs.existsSync(path.join(target, 'data')), false, '--no-start must not launch the server');
  ok(run('/bin/bash', [path.join(target, 'Start StudyTrail.command'), '--port', '8768'], env));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'data/started.json'))), ['--data-dir',path.join(target,'data'),'--port','8768']);
  const downloads = fs.readFileSync(record, 'utf8');
  write(path.join(target, 'data/private-record'), 'keep this');
  ok(run('/bin/bash', [installer, '--install-dir', target, '--no-start'], env));
  assert.equal(fs.readFileSync(record, 'utf8'), downloads, 'rerun must reuse the installed application');
  assert.equal(fs.readFileSync(path.join(target, 'data/private-record'), 'utf8'), 'keep this');
  // Default mode starts the application, and installation/startup never need global npm.
  ok(run('/bin/bash', [installer, '--install-dir', target], env));
  // A failed dependency setup must be explicit, keep the application/data, and be retryable.
  assert.notEqual(run('/bin/bash', [installer, '--install-dir', target, '--repair-tandix','--no-start'], {...env,STUDYTRAIL_TEST_FAIL_TANDIX:'1'}).status, 0);
  assert.equal(fs.existsSync(path.join(target,'.tandix-setup-v1')),false);
  assert.equal(fs.readFileSync(path.join(target, 'data/private-record'),'utf8'),'keep this');
  ok(run('/bin/bash', [installer, '--install-dir', target,'--no-start'], {...env,STUDYTRAIL_TEST_READ_STDIN:'1'},undefined,'extension-confirmed\n'));
  assert.ok(fs.existsSync(path.join(target,'.tandix-setup-v1')));
  // Missing Codex uses a private npm prefix, not a global system installation.
  const privateCli = path.join(root,'private-cli');
  ok(run('/bin/bash',[installer,'--install-dir',privateCli,'--no-start'],{...env,STUDYTRAIL_TEST_MISSING_CODEX:'1'}));
  assert.ok(fs.existsSync(path.join(privateCli,'tools/bin/codex')));
  const loginFailure = path.join(root,'login-failed');
  assert.notEqual(run('/bin/bash',[installer,'--install-dir',loginFailure],{...env,STUDYTRAIL_TEST_FAIL_LOGIN:'1'}).status,0);
  assert.ok(fs.existsSync(path.join(loginFailure,'.studytrail-installer-v1')));
  assert.equal(fs.existsSync(path.join(loginFailure,'.tandix-setup-v1')),false);
  assert.equal(fs.existsSync(path.join(loginFailure,'data/started.json')),false,'failed setup must not launch StudyTrail');
  ok(run('/bin/bash',[installer,'--install-dir',loginFailure,'--no-start'],env));
  const missingBrowser = path.join(root,'missing-browser');
  assert.notEqual(run('/bin/bash',[installer,'--install-dir',missingBrowser,'--no-start'],{...env,STUDYTRAIL_TEST_MISSING_CHROME:'1'}).status,0);
  assert.equal(fs.existsSync(path.join(missingBrowser,'.tandix-setup-v1')),false);
  ok(run('/bin/bash',[installer,'--install-dir',missingBrowser,'--no-start'],env));
  const skipped = path.join(root,'skip-ai');
  const beforeSkip = fs.readFileSync(tandemRecord,'utf8');
  ok(run('/bin/bash',[installer,'--install-dir',skipped,'--no-start','--skip-tandix'],env));
  assert.equal(fs.readFileSync(tandemRecord,'utf8'),beforeSkip);
  assert.equal(fs.existsSync(path.join(skipped,'.tandix-setup-v1')),false);
  ok(run('/bin/bash',[installer,'--install-dir',skipped,'--no-start'],env));
  const occupied = path.join(root, 'unmanaged');
  write(path.join(occupied, 'important'), 'untouched');
  assert.notEqual(run('/bin/bash', [installer, '--install-dir', occupied, '--no-start'], env).status, 0);
  assert.equal(fs.readFileSync(path.join(occupied, 'important'), 'utf8'), 'untouched');
  for (const failure of ['STUDYTRAIL_TEST_BAD_HASH','STUDYTRAIL_TEST_FAIL_NPM']) {
    const failed = path.join(root, failure);
    assert.notEqual(run('/bin/bash', [installer, '--install-dir', failed, '--no-start'], {...env,[failure]:'1'}).status, 0);
    assert.equal(fs.existsSync(failed), false, 'failed installation must not be published');
    assert.equal(fs.existsSync(failed + '.install-lock'), false, 'lock must be cleaned after failure');
  }
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked + '.install-lock');
  assert.notEqual(run('/bin/bash', [installer, '--install-dir', locked, '--no-start'], env).status, 0);
  assert.ok(fs.existsSync(locked + '.install-lock'), 'must not remove another installer lock');
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.studytrail-install.')), false);
  console.log('macOS installer: fresh install, official Tandix handoff, permanent runtime/Codex paths, private CLI, interaction, skip/repair/retry, data preservation, failures and locks passed.');
} finally {
  fs.rmSync(root, {recursive:true, force:true});
}
