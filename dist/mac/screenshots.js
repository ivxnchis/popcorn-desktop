// Drive a running Popcorn Time over the DevTools protocol and save
// screenshots of the main screens. Start the app with
// --remote-debugging-port=<port> first.
//
// Usage: node dist/mac/screenshots.js <outDir> [port]
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const outDir = process.argv[2] || 'screenshots';
const port = Number(process.argv[3] || 9222);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function findPage() {
  for (let i = 0; i < 90; i++) {
    try {
      const targets = await getJSON(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page) {
        return page;
      }
    } catch (e) {
      // app not listening yet
    }
    await sleep(1000);
  }
  throw new Error('App page not found on the DevTools port');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const pending = new Map();
    let nextId = 0;
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      const send = (method, params = {}) => {
        const id = ++nextId;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      };
      const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
          const ex = r.exceptionDetails.exception;
          throw new Error((ex && ex.description) || r.exceptionDetails.text);
        }
        return r.result.value;
      };
      resolve({ ws, send, evaluate });
    });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const page = await findPage();
  console.log('Connected to', page.url);
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');

  const waitFor = async (expression, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await cdp.evaluate(expression)) {
          return true;
        }
      } catch (e) {
        // page still booting
      }
      await sleep(500);
    }
    throw new Error('Timed out waiting for: ' + expression);
  };
  const click = (selector) =>
    cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const hover = async (selector) => {
    const box = await cdp.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  };
  const unhover = () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 400 });
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(data, 'base64'));
    console.log('Saved', name);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`Step "${name}" failed: ${e.message}`);
    }
  };
  const itemsLoaded = `document.querySelectorAll('.items .item').length >= 6`;

  await cdp.evaluate(`nw.Window.get().resizeTo(1280, 800), true`);
  await sleep(1500);
  console.log('Viewport:', await cdp.evaluate(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, screen: [screen.width, screen.height] })`));

  await step('disclaimer', async () => {
    await waitFor(`!!(document.querySelector('#disclaimer-container .btn-accept') || document.querySelector('.items .item'))`, 60000);
    if (await click('#disclaimer-container .btn-accept') === false) {
      return;
    }
    await sleep(500);
  });

  await step('movies', async () => {
    await waitFor(itemsLoaded, 60000);
    await sleep(6000);
    await shot('01-movies');
    await hover('.items .item:nth-child(2) .cover');
    await sleep(800);
    await shot('02-movies-hover');
    await unhover();
  });

  await step('movie detail', async () => {
    await click('.items .item .cover');
    await waitFor(`!!document.querySelector('#movie-detail .close-icon')`);
    await sleep(5000);
    await shot('03-movie-detail');
    await click('#movie-detail .close-icon');
    await sleep(1000);
  });

  await step('shows', async () => {
    await click('.source.tvshowTabShow');
    await sleep(1500);
    await waitFor(itemsLoaded, 60000);
    await sleep(6000);
    await shot('04-shows');
  });

  await step('show detail', async () => {
    await click('.items .item .cover');
    await waitFor(`!!document.querySelector('.show-detail-container')`);
    await sleep(6000);
    await shot('05-show-detail');
    await click('.show-detail-container .close-icon');
    await sleep(1000);
  });

  await step('settings', async () => {
    await click('#filterbar-settings');
    await waitFor(`!!document.querySelector('.settings-container')`);
    await sleep(1500);
    await shot('06-settings');
    await click('.settings-container .close-icon');
    await sleep(500);
  });

  cdp.ws.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
