// Reuses the sibling minimaCore Desktop updater-test.cjs Electron/HTTPS stubs.
// Real file writes, no live network, installer launches, or user Downloads access.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandaget-download-review-'));
  const requests = [], revealed = [];
  const electron = { app: { getVersion: () => 'test', getPath: () => dir },
    shell: { showItemInFolder: p => revealed.push(p) } };
  const https = { get(url, opts, cb) {
    const req = new EventEmitter();
    req.destroy = e => req.emit('error', e);
    requests.push({ respond(body) {
      const res = Readable.from([Buffer.from(body)]);
      res.statusCode = 200;
      res.headers = { 'content-length': String(Buffer.byteLength(body)) };
      cb(res);
    } });
    return req;
  } };
  const context = { module: { exports: {} }, URL, require(name) {
    return name === 'electron' ? electron : name === 'https' ? https : require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main/download.js'), 'utf8'), context);
  return { dir, requests, revealed, download: context.module.exports.downloadInstaller };
}
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const row = (body, host = 'one.example') => ({ file: `https://${host}/App-1.2.3.dmg`, packageId: host, sha256: digest(body) });

test('same destination cannot be written by overlapping transfers; retry works after completion', async () => {
  const f = fixture();
  const first = f.download(row('first'), () => {});
  await assert.rejects(f.download(row('second', 'two.example'), () => {}), /already downloading/);
  assert.equal(f.requests.length, 1);
  f.requests[0].respond('first');
  const saved = await first;
  assert.equal(fs.readFileSync(saved, 'utf8'), 'first');
  const retry = f.download(row('second'), () => {});
  f.requests[1].respond('second');
  await retry;
  assert.equal(fs.readFileSync(saved, 'utf8'), 'second');
  assert.equal(f.revealed.length, 2);
});

test('missing or malformed checksum rejects before network or file writes', async () => {
  const f = fixture();
  for (const sha256 of ['', 'abc', 'g'.repeat(64)]) {
    await assert.rejects(f.download({ ...row('ok'), sha256 }, () => {}), /SHA-256/);
  }
  assert.equal(f.requests.length, 0);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('checksum failure preserves an existing installer and releases destination for retry', async () => {
  const f = fixture(), dest = path.join(f.dir, 'App-1.2.3.dmg');
  fs.writeFileSync(dest, 'existing');
  const failed = f.download(row('expected'), () => {});
  f.requests[0].respond('wrong');
  await assert.rejects(failed, /Checksum mismatch/);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'existing');
  assert.equal(fs.existsSync(dest + '.part'), false);
  assert.equal(f.revealed.length, 0);
  const retry = f.download(row('expected'), () => {});
  f.requests[1].respond('expected');
  await retry;
  assert.equal(fs.readFileSync(dest, 'utf8'), 'expected');
});

test('large payload survives write-stream backpressure and is verified on disk', async () => {
  const f = fixture(), payload = Buffer.alloc(2 * 1024 * 1024, 97);
  const pending = f.download(row(payload), () => {});
  f.requests[0].respond(payload);
  const saved = await pending;
  assert.equal(digest(fs.readFileSync(saved)), digest(payload));
});
