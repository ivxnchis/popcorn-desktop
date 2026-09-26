// Drive a running Popcorn Time over the DevTools protocol and save
// screenshots of the main screens. Start the app with
// --remote-debugging-port=<port> first.
//
// The app only reads its API servers at startup, so run this twice:
//   node dist/mac/screenshots.js <outDir> <port> prepare   (accept terms, set API_URLS as the servers, quit)
//   node dist/mac/screenshots.js <outDir> <port> capture   (take the screenshots)
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const outDir = process.argv[2] || 'screenshots';
const port = Number(process.argv[3] || 9222);
const phase = process.argv[4] || 'capture';
const apiUrls = process.env.API_URLS || 'http://127.0.0.1:8099/';
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
  // never hold up the build for long
  setTimeout(() => {
    console.error(`Gave up after 6 minutes (${phase})`);
    process.exit(1);
  }, 6 * 60 * 1000).unref();

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

  // keep console errors and failed requests for debugging
  const problems = [];
  const requests = {};
  cdp.ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push('exception: ' + msg.params.exceptionDetails.text + ' ' + JSON.stringify(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description));
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value || a.description).join(' '));
    } else if (msg.method === 'Network.loadingFailed') {
      problems.push('request failed: ' + msg.params.errorText + ' ' + (requests[msg.params.requestId] || ''));
    }
  });
  cdp.ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Network.requestWillBeSent') {
      requests[msg.params.requestId] = msg.params.request.url;
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  const saveProblems = () => fs.writeFileSync(path.join(outDir, `console-${phase}.log`), problems.join('\n') + '\n');

  // lay the page out at a fixed size, whatever the runner's screen is
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  if (phase === 'prepare') {
    await step('disclaimer', async () => {
      await waitFor(`!!(document.querySelector('#disclaimer-container .btn-accept') || document.querySelector('.items .item'))`, 60000);
      if (await cdp.evaluate(`!!document.querySelector('#disclaimer-container .btn-accept')`)) {
        await sleep(1500);
        await shot('00-terms');
        await click('#disclaimer-container .btn-accept');
      }
    });
    // CI can't reach the DHT, so set the API servers directly (the real ones, or
    // dist/mac/sample-api.js); turning off DHT updates keeps them from being replaced
    await step('api servers', async () => {
      await cdp.evaluate(`['customMoviesServer', 'customSeriesServer', 'customAnimeServer'].forEach((k) => AdvSettings.set(k, ${JSON.stringify(apiUrls)})), AdvSettings.set('dhtEnable', false), true`);
    });
    saveProblems();
    await cdp.evaluate(`setTimeout(() => nw.App.quit(), 3000), true`).catch(() => {});
    cdp.ws.close();
    return;
  }

  await sleep(1500);

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

  // the same screens in the original theme, for before/after comparisons
  await step('classic theme', async () => {
    await cdp.evaluate(`$('link#theme').attr('href', 'themes/Official_-_Dark_theme.css'), true`);
    await click('.source.movieTabShow');
    await sleep(1500);
    await waitFor(itemsLoaded, 60000);
    await sleep(5000);
    await shot('classic-01-movies');
    await click('.items .item .cover');
    await waitFor(`!!document.querySelector('#movie-detail .close-icon')`);
    await sleep(5000);
    await shot('classic-03-movie-detail');
    await click('#movie-detail .close-icon');
  });

  saveProblems();
  cdp.ws.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
