/* Drives the card rendered by layouts/shortcodes/listenbrainz.html.

   State comes from two GETs against api.listenbrainz.org (playing-now + the
   latest listen). Updates arrive three ways, cheapest first:
     - the live feed ListenBrainz's own user page subscribes to (Socket.IO over a
       bare WebSocket, see openFeed) pushes playing_now / listen events, each of
       which triggers a refetch;
     - a timer re-checks when the live track should have ended (its duration is
       in the payload) and, as a safety net, every 2 min with the feed up or
       every 30 s without it;
     - the last result is kept in sessionStorage so the next page paints the
       known track at once and corrects itself after the first fetch.
   Everything pauses while the tab is hidden. The API allows 30 requests per
   window *per client IP*, so none of this comes near the limit.

   Cover art: ListenBrainz resolves finished listens to MusicBrainz ids and hands
   back a Cover Art Archive id with them, but a playing-now listen has no mapping
   yet. The listen that was just submitted is usually the same track, so its art
   is reused; otherwise a MusicBrainz search fills the gap. Results are cached
   per track so re-polls cost nothing. */

const API = "https://api.listenbrainz.org/1/user/";
const FEED = "wss://listenbrainz.org/socket.io/?EIO=4&transport=websocket";
const POLL_MS = 30_000; // no feed: plain polling
const SAFETY_MS = 120_000; // feed up: it does the work, this catches missed events
const RETRY_MS = 90_000; // after an API error
const FEED_RETRY_MS = [5_000, 120_000]; // reconnect backoff: first try, cap
const CACHE_MS = 5 * 60_000; // how long a sessionStorage snapshot may paint

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

function trackKey(listen) {
  const t = listen.track_metadata;
  return [t.artist_name, t.release_name, t.track_name].map((s) => (s || "").toLowerCase()).join("\u0000");
}

/* Track length in ms, if the scrobbler sent one. */
function durationMs(listen) {
  const info = listen.track_metadata.additional_info || {};
  if (info.duration_ms > 0) return info.duration_ms;
  if (info.duration > 0) return info.duration * 1000;
  return null;
}

/* ListenBrainz's own thumbnail URL for a mapped listen. */
function mappedArt(listen) {
  const m = listen.track_metadata.mbid_mapping;
  if (!m || !m.caa_id || !m.caa_release_mbid) return null;
  return `https://archive.org/download/mbid-${m.caa_release_mbid}/mbid-${m.caa_release_mbid}-${m.caa_id}_thumb250.jpg`;
}

/* Lucene queries against MusicBrainz (CORS-enabled, be polite: 1 req/s). The
   release name is tried first; scrobblers often invent one (YouTube uploads),
   so the recording itself is the fallback and its first release's group wins. */
const quote = (s) => `"${s.replace(/["\\]/g, " ")}"`;

async function search(entity, query) {
  const url = `https://musicbrainz.org/ws/2/${entity}/?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
  return getJSON(url);
}

/* Candidate cover URLs, best guess first; not every release group has art. */
async function searchArt(listen) {
  const t = listen.track_metadata;
  if (!t.artist_name) return [];
  const groups = [];
  if (t.release_name) {
    const data = await search("release-group", `releasegroup:${quote(t.release_name)} AND artist:${quote(t.artist_name)}`);
    for (const g of data["release-groups"] || []) groups.push(g.id);
  }
  if (!groups.length && t.track_name) {
    const data = await search("recording", `recording:${quote(t.track_name)} AND artist:${quote(t.artist_name)}`);
    for (const r of data.recordings?.[0]?.releases || []) groups.push(r["release-group"]?.id);
  }
  return [...new Set(groups.filter(Boolean))].slice(0, 4)
    .map((id) => `https://coverartarchive.org/release-group/${id}/front-250`);
}

/* Resolves to the first URL that actually loads as an image, else null. */
function firstLoadable(urls) {
  return urls.reduce(
    (chain, url) => chain.then((found) => found || new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(url);
      probe.onerror = () => resolve(null);
      probe.src = url;
    })),
    Promise.resolve(null),
  );
}

/* Dominant colour of the cover as "r g b", weighted towards saturated pixels so
   a mostly white sleeve with a red logo tints red. Needs CORS on the image host
   (the Cover Art Archive and archive.org send it); otherwise null, no tint. */
function sampleTint(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const n = 12;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = n;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        const { data } = ctx.getImageData(0, 0, n, n);
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < data.length; i += 4) {
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const min = Math.min(data[i], data[i + 1], data[i + 2]);
          const sat = max ? (max - min) / max : 0;
          const weight = 0.05 + sat * sat;
          r += data[i] * weight;
          g += data[i + 1] * weight;
          b += data[i + 2] * weight;
          w += weight;
        }
        // Lift near-black sleeves so the tint still reads as a colour, keeping the hue.
        const rgb = [r, g, b].map((c) => c / w);
        const peak = Math.max(...rgb);
        const lift = peak < 96 ? 96 / Math.max(peak, 1) : 1;
        resolve(rgb.map((c) => Math.round(Math.min(255, c * lift))).join(" "));
      } catch {
        resolve(null); // tainted canvas
      }
    };
    img.src = url;
  });
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(unixSeconds) {
  const delta = Math.round((unixSeconds * 1000 - Date.now()) / 1000);
  const units = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(delta) >= size) return relative.format(Math.round(delta / size), unit);
  }
  return "just now";
}

/* Just enough Engine.IO v4 / Socket.IO v5 over a bare WebSocket to subscribe
   to the feed listenbrainz.org's user page uses (frontend/js/src/user/
   Dashboard.tsx in metabrainz/listenbrainz-server):
     0{…}       server hello, carries pingInterval / pingTimeout
     40         connect to the default namespace; acked with 40{sid}
     42[ev, …]  event; we send ["json", {user}] and get playing_now / listen
     2 / 3      ping / pong
   The feed is undocumented, so it only ever *triggers* a refetch; anything
   unexpected (or a missed ping) closes the socket and polling takes over. */
function openFeed(user, handlers) {
  const ws = new WebSocket(FEED);
  let pingInterval = 25_000;
  let pingTimeout = 20_000;
  let watchdog = null;
  const expectPing = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ws.close(), pingInterval + pingTimeout);
  };
  ws.onmessage = ({ data }) => {
    const msg = String(data);
    expectPing();
    if (msg[0] === "0") {
      try {
        const hello = JSON.parse(msg.slice(1));
        pingInterval = hello.pingInterval || pingInterval;
        pingTimeout = hello.pingTimeout || pingTimeout;
      } catch { /* defaults are fine */ }
      ws.send("40");
    } else if (msg === "2") {
      ws.send("3");
    } else if (msg.startsWith("40")) {
      ws.send(`42${JSON.stringify(["json", { user }])}`);
      handlers.onOpen();
    } else if (msg.startsWith("42")) {
      try {
        handlers.onEvent(JSON.parse(msg.slice(2))[0]);
      } catch { /* not for us */ }
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    clearTimeout(watchdog);
    handlers.onClose();
  };
  return ws;
}

function mount(root) {
  const user = root.dataset.listenbrainzUser;
  const base = API + encodeURIComponent(user);
  const cacheKey = `listenbrainz:${user}`;
  const cover = root.querySelector(".listenbrainz__cover");
  const backdrop = root.querySelector(".listenbrainz__backdrop"); // backdrop variant only
  const label = root.querySelector(".listenbrainz__label");
  const track = root.querySelector(".listenbrainz__track");
  const artist = root.querySelector(".listenbrainz__artist");
  const release = root.querySelector(".listenbrainz__release");
  const artCache = new Map(); // track key -> { url, tint }, both nullable
  let shownKey = null;
  let current = null; // { live, listen, recent } behind what is on screen
  let endGuess = null; // when the live track should be over (ms epoch)
  let timer = null;
  let feed = null;
  let feedUp = false;
  let feedTimer = null;
  let feedRetry = FEED_RETRY_MS[0];

  cover.addEventListener("error", () => root.classList.remove("has-art"));
  cover.addEventListener("load", () => root.classList.add("has-art"));

  function readCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey));
      if (c && c.listen && Date.now() - c.at < CACHE_MS) return c;
    } catch { /* storage unavailable or stale shape */ }
    return null;
  }

  function writeCache() {
    if (!current) return;
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), ...current, art: artCache.get(shownKey) ?? null }));
    } catch { /* private mode, quota - the cache is only a nicety */ }
  }

  async function showArt(key, listen, recent) {
    if (!artCache.has(key)) {
      let url = mappedArt(listen);
      if (!url && recent && trackKey(recent) === key) url = mappedArt(recent);
      if (!url) url = await searchArt(listen).then(firstLoadable).catch(() => null);
      const tint = url ? await sampleTint(url) : null;
      artCache.set(key, { url, tint });
    }
    const { url, tint } = artCache.get(key);
    if (shownKey !== key) return; // the track changed while we were searching
    if (!url) {
      root.classList.remove("has-art");
      cover.removeAttribute("src");
      backdrop?.removeAttribute("src");
    } else if (cover.getAttribute("src") !== url) {
      root.classList.remove("has-art");
      cover.src = url;
      if (backdrop) backdrop.src = url;
    }
    if (tint) {
      root.style.setProperty("--listenbrainz-tint", tint);
      root.classList.add("has-tint");
    } else {
      root.style.removeProperty("--listenbrainz-tint");
      root.classList.remove("has-tint");
    }
    writeCache();
  }

  function render(listen, live, recent, seenAt = Date.now()) {
    const t = listen.track_metadata;
    const info = t.additional_info || {};
    const key = trackKey(listen);

    root.dataset.listenbrainzState = live ? "playing" : "idle";
    label.textContent = live ? "Now playing" : `Last played ${ago(listen.listened_at)}`;
    current = { live, listen, recent };

    if (key !== shownKey) {
      shownKey = key;
      // Upper bound: the track was at most this far from its end when first seen.
      const ms = live ? durationMs(listen) : null;
      endGuess = ms ? seenAt + ms : null;
      track.replaceChildren();
      if (info.origin_url) {
        const a = document.createElement("a");
        a.href = info.origin_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = t.track_name;
        track.append(a);
      } else {
        track.textContent = t.track_name;
      }
      artist.textContent = t.artist_name || "";
      release.textContent = t.release_name || "";
      showArt(key, listen, recent);
    } else if (!live) {
      endGuess = null;
    }
    writeCache();
  }

  async function poll() {
    clearTimeout(timer);
    timer = null;
    if (endGuess && Date.now() >= endGuess) endGuess = null; // guess spent: back to the plain cadence
    try {
      const [now, history] = await Promise.all([
        getJSON(`${base}/playing-now`),
        getJSON(`${base}/listens?count=1`),
      ]);
      const live = now.payload.listens[0] || null;
      const recent = history.payload.listens[0] || null;
      if (live) render(live, true, recent);
      else if (recent) render(recent, false, null);
      else root.dataset.listenbrainzState = "empty";
      schedule();
    } catch (err) {
      console.warn("listenbrainz:", err);
      if (shownKey === null) root.dataset.listenbrainzState = "error";
      schedule(RETRY_MS);
    }
  }

  /* Next check: the safety cadence, or sooner if the live track should end first. */
  function schedule(override) {
    clearTimeout(timer);
    timer = null;
    if (document.visibilityState !== "visible") return;
    let delay = override ?? (feedUp ? SAFETY_MS : POLL_MS);
    if (!override && endGuess) delay = Math.max(3_000, Math.min(delay, endGuess - Date.now() + 2_000));
    timer = setTimeout(poll, delay);
  }

  /* Feed events arrive slightly before the API reflects them; debounce a little. */
  function bump() {
    clearTimeout(timer);
    timer = setTimeout(poll, 750);
  }

  function connectFeed() {
    clearTimeout(feedTimer);
    feedTimer = null;
    if (feed || document.visibilityState !== "visible" || typeof WebSocket === "undefined") return;
    feed = openFeed(user, {
      onOpen() {
        feedUp = true;
        feedRetry = FEED_RETRY_MS[0];
        root.dataset.listenbrainzFeed = "live";
        schedule();
      },
      onEvent(event) {
        if (event === "playing_now" || event === "listen") bump();
      },
      onClose() {
        feed = null;
        feedUp = false;
        root.dataset.listenbrainzFeed = "poll";
        if (document.visibilityState === "visible") {
          feedTimer = setTimeout(connectFeed, feedRetry);
          feedRetry = Math.min(feedRetry * 2, FEED_RETRY_MS[1]);
        }
        schedule();
      },
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      poll();
      connectFeed();
    } else {
      clearTimeout(timer);
      clearTimeout(feedTimer);
      timer = feedTimer = null;
      if (feed) feed.close(); // onClose sees the hidden tab and does not reconnect
    }
  });

  const cached = readCache();
  if (cached) {
    if (cached.art && typeof cached.art === "object") artCache.set(trackKey(cached.listen), cached.art);
    render(cached.listen, cached.live, cached.recent, cached.at);
  }
  root.dataset.listenbrainzFeed = "poll";
  poll();
  connectFeed();
}

document.querySelectorAll("[data-listenbrainz-user]").forEach(mount);
