const { JSDOM } = require('jsdom');
const { TonConnectUI } = require('@tonconnect/ui');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage;

const matchMediaMock = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
window.matchMedia = matchMediaMock;
global.matchMedia = matchMediaMock;

global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.requestAnimationFrame = global.requestAnimationFrame;

global.customElements = { define() {}, get() {} };

const createEvent = (type) => new dom.window.Event(type);
const originalDispatch = window.dispatchEvent.bind(window);
window.dispatchEvent = function(event) {
  if (typeof event === 'string') {
    return originalDispatch(createEvent(event));
  }
  return originalDispatch(event);
};

global.fetch = async (url) => {
  if (url.includes('tonconnect-manifest.json')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    };
  }
  if (url.includes('wallets-v2.json')) {
    return {
      ok: true,
      status: 200,
      json: async () => []
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({})
  };
};

try {
  const ui = new TonConnectUI({ manifestUrl: 'https://example.com/tonconnect-manifest.json' });
  console.log('created TonConnectUI', Boolean(ui));
} catch (error) {
  console.error('failed', error);
}

