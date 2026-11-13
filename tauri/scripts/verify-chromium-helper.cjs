'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function verify() {
  const [executable, runtime] = process.argv.slice(2);
  assert.ok(executable && runtime, 'Pass the Electron executable and engine directory');
  const { createChromiumBridge } = require(path.join(path.resolve(runtime), 'chromiumBridge.cjs'));
  const profile = await mkdtemp(path.join(tmpdir(), 'altcrate-chromium-'));
  const children = [];
  const events = [];
  let writes = 0;
  let mutationArrived;
  const arrived = new Promise(resolve => { mutationArrived = resolve; });
  const server = createServer((request, response) => {
    if (request.url === '/set-cookie') {
      response.setHeader('Set-Cookie', 'altcrate_fixture=partition-a; Path=/; Max-Age=3600; HttpOnly');
      response.end('<title>AltCrate offline sign-in</title>');
    } else if (request.url === '/hold' && request.method === 'POST') {
      writes++;
      mutationArrived();
    } else {
      response.end(request.headers.cookie || '');
    }
  });
  let bridge;

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    bridge = createChromiumBridge({
      executable,
      dataDirectory: profile,
      onEvent: event => events.push(event),
      spawnProcess(command, args, options) {
        const child = spawn(command, [...args, '--casepilot-test-origin', origin], options);
        children.push(child);
        child.stderr.on('data', chunk => process.stderr.write(chunk));
        return child;
      },
    });
    const call = (method, args) => bridge.request(method, args, AbortSignal.timeout(20_000));
    const accountA = { id: 'login-a', partition: 'persist:fixture-a', background: true };
    const accountB = { id: 'login-b', partition: 'persist:fixture-b', background: true };
    const seeded = {
      name: '__Host-altcrate_fixture',
      value: 'synthetic',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: Math.floor(Date.now() / 1000) + 3600,
    };

    await call('login.create', { ...accountA, cookies: [seeded] });
    await call('login.create', accountB);
    const identity = await call('login.load', { ...accountA, url: origin + '/set-cookie' });
    assert.match(identity.userAgent, /Chrome\//);
    assert.deepEqual(await call('session.info'), { windows: 2, sessions: 2, transport: 'chromium-session' });
    assert.equal(await call('login.script', { ...accountA, script: 'document.title' }), 'AltCrate offline sign-in');
    assert.ok(events.some(event => event.id === accountA.id && event.event === 'did-finish-load'));

    const echo = async (account, credentials) => {
      const result = await call('login.fetch', { ...account, url: origin + '/echo', credentials });
      assert.equal(result.status, 200);
      return Buffer.from(result.body, 'base64').toString('utf8');
    };
    assert.equal(await echo(accountA), 'altcrate_fixture=partition-a');
    assert.equal(await echo(accountB), '');
    assert.equal(await echo(accountA, 'omit'), '');
    assert.equal((await call('login.cookies', accountA)).find(cookie => cookie.name === seeded.name)?.value, seeded.value);
    assert.deepEqual(await call('login.cookies', accountB), []);
    await assert.rejects(call('login.fetch', { ...accountA, url: 'https://case-clicker.com/' }));
    await assert.rejects(call('login.load', { ...accountB, url: 'https://case-clicker.com/' }));

    await call('login.retain', accountA);
    assert.equal((await call('session.info')).windows, 1);
    assert.equal(await echo(accountA), 'altcrate_fixture=partition-a');
    assert.ok(!events.some(event => event.id === accountA.id && event.event === 'closed'));

    const mutation = call('login.fetch', { ...accountA, url: origin + '/hold', method: 'POST' });
    const terminate = async () => {
      await Promise.race([
        arrived,
        delay(15_000, null, { ref: false }).then(() => { throw Error('The loopback server did not receive the POST'); }),
      ]);
      const exited = once(children[0], 'exit');
      children[0].kill();
      await exited;
    };
    await Promise.all([terminate(), assert.rejects(mutation, /sign-in browser closed/)]);
    assert.ok(events.some(event => event.id === accountB.id && event.event === 'closed'));

    assert.deepEqual(await call('session.info'), { windows: 0, sessions: 0, transport: 'chromium-session' });
    assert.equal(children.length, 2);
    await call('session.prepare', accountA);
    assert.equal(await echo(accountA), 'altcrate_fixture=partition-a');
    assert.equal((await call('login.cookies', accountA)).find(cookie => cookie.name === seeded.name)?.value, seeded.value);
    assert.equal(writes, 1, 'A failed mutation must not be replayed');

    return { passed: true, transport: 'chromium-session', isolatedCookies: true, retainedSession: true,
      resumedAfterHelperExit: true, blockedLiveOrigin: true, observedFixtureWrites: writes };
  } finally {
    bridge?.close();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        await once(child, 'exit');
      }
    }
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
}

verify().then(report => process.stdout.write(JSON.stringify(report) + '\n')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
