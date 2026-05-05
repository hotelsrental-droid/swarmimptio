/*!
 * IMPT Swarm Widget v0.1.0
 * The open-source hotel-search widget that pays you 5%.
 * https://github.com/impt/swarm-widget
 * MIT License - Copyright (c) 2026 IMPT Systems Limited
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://swarm.impt.io/api/widget';
  var REDIRECT = 'https://app.impt.io/find-hotel-input';
  var STATIC_CITIES = [
    { name: 'Dublin',     country: 'IE', lat: 53.3498, lon: -6.2603, currency: 'EUR' },
    { name: 'Cork',       country: 'IE', lat: 51.8985, lon: -8.4756, currency: 'EUR' },
    { name: 'Galway',     country: 'IE', lat: 53.2707, lon: -9.0568, currency: 'EUR' },
    { name: 'Limerick',   country: 'IE', lat: 52.6638, lon: -8.6267, currency: 'EUR' },
    { name: 'Belfast',    country: 'GB', lat: 54.5973, lon: -5.9301, currency: 'GBP' },
    { name: 'London',     country: 'GB', lat: 51.5074, lon: -0.1278, currency: 'GBP' },
    { name: 'Edinburgh',  country: 'GB', lat: 55.9533, lon: -3.1883, currency: 'GBP' },
    { name: 'Manchester', country: 'GB', lat: 53.4808, lon: -2.2426, currency: 'GBP' },
    { name: 'Paris',      country: 'FR', lat: 48.8566, lon:  2.3522, currency: 'EUR' },
    { name: 'Barcelona',  country: 'ES', lat: 41.3851, lon:  2.1734, currency: 'EUR' },
    { name: 'Madrid',     country: 'ES', lat: 40.4168, lon: -3.7038, currency: 'EUR' },
    { name: 'Rome',       country: 'IT', lat: 41.9028, lon: 12.4964, currency: 'EUR' },
    { name: 'Milan',      country: 'IT', lat: 45.4642, lon:  9.1900, currency: 'EUR' },
    { name: 'Amsterdam',  country: 'NL', lat: 52.3676, lon:  4.9041, currency: 'EUR' },
    { name: 'Berlin',     country: 'DE', lat: 52.5200, lon: 13.4050, currency: 'EUR' },
    { name: 'Lisbon',     country: 'PT', lat: 38.7223, lon: -9.1393, currency: 'EUR' },
    { name: 'New York',   country: 'US', lat: 40.7128, lon:-74.0060, currency: 'USD' },
    { name: 'Los Angeles',country: 'US', lat: 34.0522, lon:-118.2437,currency: 'USD' },
    { name: 'Miami',      country: 'US', lat: 25.7617, lon:-80.1918, currency: 'USD' },
    { name: 'Tokyo',      country: 'JP', lat: 35.6762, lon: 139.6503,currency: 'JPY' },
    { name: 'Singapore',  country: 'SG', lat:  1.3521, lon: 103.8198,currency: 'SGD' },
    { name: 'Dubai',      country: 'AE', lat: 25.2048, lon:  55.2708,currency: 'AED' },
    { name: 'Sydney',     country: 'AU', lat:-33.8688, lon: 151.2093,currency: 'AUD' },
    { name: 'Bangkok',    country: 'TH', lat: 13.7563, lon: 100.5018,currency: 'THB' }
  ];

  function script() {
    return document.currentScript ||
      document.querySelector('script[src*="swarm.impt.io"][src*="widget.js"]');
  }

  function attr(s, k, d) {
    var v = s ? s.getAttribute('data-' + k) : null;
    return v == null || v === '' ? d : v;
  }

  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  function track(key, evt, dest) {
    try {
      var u = ENDPOINT + '/track?key=' + encodeURIComponent(key) +
        '&evt=' + encodeURIComponent(evt) +
        (dest ? '&dest=' + encodeURIComponent(dest) : '') +
        '&ref=' + encodeURIComponent(location.host) +
        '&ts=' + Date.now();
      var img = new Image();
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = u;
    } catch (e) { /* swallow */ }
  }

  function buildRedirect(key, dest, theme) {
    var url = REDIRECT + '?utm_source=swarm-' + encodeURIComponent(key) +
      '&utm_medium=widget' +
      '&utm_campaign=oss' +
      '&utm_content=' + encodeURIComponent(theme || 'cream');
    if (dest) {
      var hit = STATIC_CITIES.find(function (c) { return c.name.toLowerCase() === dest.toLowerCase(); });
      if (hit) {
        url += '&destination=' + encodeURIComponent(hit.name) +
          '&locationName=' + encodeURIComponent(hit.name) +
          '&tl=' + encodeURIComponent(hit.country.toLowerCase()) +
          '&gl=' + encodeURIComponent(hit.country.toLowerCase());
      } else {
        url += '&destination=' + encodeURIComponent(dest);
      }
    }
    return url;
  }

  var TEMPLATE = [
    '<style>',
    ':host{all:initial;display:block;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.box{background:#FAF7F0;color:#08423a;padding:28px;border-radius:24px;border:1px solid rgba(8,66,58,.08);box-shadow:0 12px 40px -12px rgba(8,66,58,.18)}',
    '.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#3a6b62;margin:0 0 8px}',
    '.title{font-family:"Fraunces",Georgia,serif;font-size:22px;line-height:1.18;font-weight:600;color:#08423a;margin:0 0 18px}',
    '.row{display:flex;flex-direction:column;gap:10px}',
    '@media(min-width:520px){.row{flex-direction:row;align-items:flex-end}}',
    '.field{flex:1;display:flex;flex-direction:column;gap:6px}',
    'label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#3a6b62;font-weight:500}',
    'select,input{font:inherit;padding:12px 14px;border-radius:14px;border:1px solid rgba(8,66,58,.18);background:#fff;color:#08423a;outline:0;height:46px}',
    'select:focus,input:focus{border-color:#08423a;box-shadow:0 0 0 3px rgba(8,66,58,.12)}',
    'button{font:inherit;font-weight:600;background:#C8FF7E;color:#08423a;border:0;border-radius:14px;padding:0 22px;height:46px;cursor:pointer;transition:transform .15s ease, box-shadow .15s ease}',
    'button:hover{transform:translateY(-1px);box-shadow:0 8px 24px -8px rgba(8,66,58,.35)}',
    '.foot{margin-top:14px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#3a6b62}',
    '.badge{display:inline-flex;align-items:center;gap:6px}',
    '.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#C8FF7E;box-shadow:0 0 0 3px rgba(200,255,126,.25)}',
    'a{color:#3a6b62;text-decoration:none}a:hover{text-decoration:underline}',
    '</style>',
    '<div class="box" part="container">',
    '  <p class="eyebrow" id="ey">Hotels with conscience</p>',
    '  <h3 class="title" id="ti">Find your next stay. Plant a tree per booking.</h3>',
    '  <form class="row" id="f" novalidate>',
    '    <div class="field">',
    '      <label for="d">Where to</label>',
    '      <select id="d" required></select>',
    '    </div>',
    '    <button type="submit">Search hotels →</button>',
    '  </form>',
    '  <div class="foot">',
    '    <span class="badge">€5 free credit · 5% Goodness back</span>',
    '    <a href="https://swarm.impt.io" target="_blank" rel="noopener">Powered by IMPT</a>',
    '  </div>',
    '</div>'
  ].join('');

  function render(host, opts) {
    var root = host.attachShadow({ mode: 'open' });
    var wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    root.appendChild(wrap);
    var sel = root.getElementById('d');
    var form = root.getElementById('f');
    if (opts.title) root.getElementById('ti').textContent = opts.title;
    var def = document.createElement('option');
    def.value = '';
    def.textContent = 'Choose a destination';
    sel.appendChild(def);
    STATIC_CITIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + ', ' + c.country;
      if (opts.dest && opts.dest.toLowerCase() === c.name.toLowerCase()) o.selected = true;
      sel.appendChild(o);
    });
    track(opts.key, 'view');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var dest = sel.value;
      if (!dest) { sel.focus(); return; }
      track(opts.key, 'click', dest);
      window.location.href = buildRedirect(opts.key, dest, opts.theme);
    });
  }

  function mount(target, opts) {
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return;
    if (host.shadowRoot) host.innerHTML = ''; // re-mount safe
    render(host, opts || {});
  }

  function autoMount() {
    var s = script();
    var key = attr(s, 'key');
    if (!key) {
      console.warn('[impt-swarm] missing data-key — get one at https://partners.impt.io/widget');
      return;
    }
    var opts = {
      key: key,
      cause: attr(s, 'cause', 'trees'),
      theme: attr(s, 'theme', 'cream'),
      dest: attr(s, 'dest'),
      title: attr(s, 'title')
    };
    var host = document.getElementById('impt-swarm') ||
      document.querySelector('[data-impt-swarm]');
    if (!host) {
      host = document.createElement('div');
      host.id = 'impt-swarm';
      (s && s.parentNode ? s.parentNode : document.body).appendChild(host);
    }
    mount(host, opts);
  }

  // expose programmatic API
  window.ImptSwarm = { mount: mount, version: '0.1.0' };

  ready(autoMount);
})();
