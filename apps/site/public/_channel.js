/* Shared client-side helper for every per-channel landing page.
 *
 * Reads ?key= and ?dest= from the URL, fires a tracking beacon, and exposes a
 * tiny SwarmChannel API every page can use:
 *   SwarmChannel.bookNow()  — 302 to canonical find-hotel-input redirect
 *   SwarmChannel.track(evt) — beacon a custom event
 */
(function () {
  'use strict';
  var url = new URL(location.href);
  var key = url.searchParams.get('key') || 'swarm-public';
  var dest = url.searchParams.get('dest') || url.searchParams.get('destination') || '';
  var creator = url.searchParams.get('creator') || '';
  var channel = (document.body && document.body.dataset && document.body.dataset.channel) || '';
  var clickId = url.searchParams.get('gclid') || url.searchParams.get('fbclid') || url.searchParams.get('click_id') || '';

  function track(evt) {
    try {
      var u = 'https://swarm.impt.io/api/widget/track' +
        '?key=' + encodeURIComponent(key) +
        '&evt=' + encodeURIComponent(evt) +
        '&channel=' + encodeURIComponent(channel) +
        (dest ? '&dest=' + encodeURIComponent(dest) : '') +
        '&ref=' + encodeURIComponent(document.referrer ? new URL(document.referrer).host : location.host) +
        '&ts=' + Date.now();
      var img = new Image();
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = u;
    } catch (e) { /* swallow */ }
  }

  function bookNowUrl(overrideDest) {
    var d = (overrideDest || dest || '').trim();
    var base = 'https://app.impt.io/find-hotel-input';
    var p = new URLSearchParams();
    if (d) {
      p.set('destination', d);
      p.set('locationName', d);
    }
    p.set('utm_source', 'swarm-' + key);
    p.set('utm_medium', channel || 'widget');
    p.set('utm_campaign', url.searchParams.get('campaign') || 'oss');
    p.set('utm_content', creator || url.searchParams.get('theme') || 'cream');
    if (clickId) p.set('click_id', clickId);
    return base + '?' + p.toString();
  }

  function bookNow(overrideDest) {
    track('click');
    location.href = bookNowUrl(overrideDest);
  }

  // Auto-fire 'enter' on load
  if (document.readyState !== 'loading') track('enter');
  else document.addEventListener('DOMContentLoaded', function () { track('enter'); });

  window.SwarmChannel = {
    track: track,
    bookNow: bookNow,
    bookNowUrl: bookNowUrl,
    key: key,
    dest: dest,
    channel: channel
  };
})();
