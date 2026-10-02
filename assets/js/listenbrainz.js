/* Drives the cards rendered by layouts/shortcodes/listenbrainz.html.

   Every card for the same user shares one source (createSource), so a page
   with several variants still costs one poll loop, one feed socket and one art
   lookup per track. State comes from two GETs against api.listenbrainz.org
   (playing-now + the latest listen). Updates arrive three ways, cheapest first:
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
   is reused; otherwise ListenBrainz's own matcher, a MusicBrainz search, iTunes
   Search and finally the YouTube thumbnail are tried in turn (searchArt). Once
   ListenBrainz maps the finished listen, its cover replaces whatever was
   guessed. The cover's dominant colour is sampled alongside. Results are
   cached per track. */

const API = "https://api.listenbrainz.org/1/user/";
const FEED = "wss://listenbrainz.org/socket.io/?EIO=4&transport=websocket";
const POLL_MS = 30_000; // no feed: plain polling
const SAFETY_MS = 120_000; // feed up: it does the work, this catches missed events
const RETRY_MS = 90_000; // after an API error
const FEED_RETRY_MS = [5_000, 120_000]; // reconnect backoff: first try, cap
const CACHE_MS = 5 * 60_000; // how long a sessionStorage snapshot may paint
const UNKNOWN_LENGTH_MS = 10 * 60_000; // how long a live track without a duration counts as playing

const TIMEOUT_MS = 10_000; // give up on a request well before the browser would

async function getJSON(url) {
  // AbortSignal.timeout is missing in older Safari; there the browser's own timeout applies.
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
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

/* MusicBrainz web service (CORS-enabled). Its policy is one request per
   second per client, so every call - lookup or search - goes through a shared
   gate that spaces them out. Browsers do not let scripts set User-Agent, so the
   visitor's browser identifies itself; each visitor has their own budget. */
const quote = (s) => `"${s.replace(/["\\]/g, " ")}"`;
let musicbrainzFreeAt = 0;

async function musicbrainz(path) {
  const wait = musicbrainzFreeAt - Date.now();
  musicbrainzFreeAt = Math.max(Date.now(), musicbrainzFreeAt) + 1_100;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return getJSON(`https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`);
}

const search = (entity, query, limit) =>
  musicbrainz(`${entity}/?query=${encodeURIComponent(query)}&limit=${limit}`);

const caa = (kind, mbid) => `https://coverartarchive.org/${kind}/${mbid}/front-250`;

/* ListenBrainz's own matcher, the one that maps finished listens: public,
   keyless, CORS-open, and given artist + title it returns the release it would
   pick. That release often has no scan of its own while another edition does,
   so its release group's cover (which the Cover Art Archive resolves to the
   best edition with art, as ListenBrainz's caa_release_mbid does) comes too,
   via a plain MusicBrainz lookup rather than a search. */
async function listenbrainzMatchArt(listen) {
  const t = listen.track_metadata;
  if (!t.artist_name || !t.track_name) return [];
  const query = `artist_credit_name=${encodeURIComponent(t.artist_name)}&recording_name=${encodeURIComponent(t.track_name)}`;
  const [match] = await getJSON(`https://labs.api.listenbrainz.org/acr-lookup/json?${query}`);
  if (!match?.release_mbid) return [];
  const release = await musicbrainz(`release/${match.release_mbid}?inc=release-groups`).catch(() => null);
  const group = release?.["release-group"]?.id;
  return [caa("release", match.release_mbid), ...(group ? [caa("release-group", group)] : [])];
}

/* Release groups that could carry the cover, from the release name first
   (scrobblers often invent one for YouTube uploads, then nothing matches) and
   otherwise from every recording of that title by that artist. Compilations go
   last: a "Promo Only" sampler rarely shows the track's own artwork. */
async function musicbrainzArt(listen) {
  const t = listen.track_metadata;
  if (!t.artist_name) return [];
  const groups = [];
  if (t.release_name) {
    const data = await search("release-group", `releasegroup:${quote(t.release_name)} AND artist:${quote(t.artist_name)}`, 3);
    for (const g of data["release-groups"] || []) groups.push({ id: g.id, compilation: false });
  }
  if (!groups.length && t.track_name) {
    const data = await search("recording", `recording:${quote(t.track_name)} AND artist:${quote(t.artist_name)}`, 5);
    for (const recording of data.recordings || []) {
      for (const release of recording.releases || []) {
        const group = release["release-group"];
        if (group?.id) groups.push({ id: group.id, compilation: (group["secondary-types"] || []).includes("Compilation") });
      }
    }
  }
  const seen = new Set();
  return groups
    .sort((a, b) => a.compilation - b.compilation)
    .filter((g) => !seen.has(g.id) && seen.add(g.id))
    .slice(0, 4)
    .map((g) => caa("release-group", g.id));
}

/* iTunes Search as the last resort: keyless, CORS-open (search and images
   alike) and far better stocked with singles and remixes than the Cover Art
   Archive. Results are kept to the scrobbled artist and ranked by how well the
   title matches, so a karaoke cover of the track does not win; the remix
   suffix is dropped for the second-best match since the original's artwork is
   close enough. */
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const baseTitle = (s) => norm((s || "").replace(/\s*[([].*?[)\]]/g, ""));

async function itunesArt(listen) {
  const t = listen.track_metadata;
  if (!t.artist_name || !t.track_name) return [];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`${t.artist_name} ${t.track_name}`)}&entity=song&limit=10`;
  const data = await getJSON(url);
  const artist = norm(t.artist_name);
  const title = norm(t.track_name);
  const base = baseTitle(t.track_name);
  return (data.results || [])
    .filter((r) => {
      const a = norm(r.artistName);
      return a && (a.includes(artist) || artist.includes(a));
    })
    .map((r) => {
      const n = norm(r.trackName);
      const score = n === title ? 3 : baseTitle(r.trackName) === base ? 2 : n.includes(base) ? 1 : 0;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ r }) => r.artworkUrl100.replace("100x100bb", "300x300bb"));
}

/* Last resort, as on listenbrainz.org itself: the thumbnail of the YouTube
   video the scrobble came from (i.ytimg.com is CORS-open). mqdefault is 16:9
   without letterbox bars, so object-fit: cover crops it cleanly. */
function youtubeArt(listen) {
  const origin = listen.track_metadata.additional_info?.origin_url || "";
  const id = origin.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{11})/)?.[1];
  return id ? [`https://i.ytimg.com/vi/${id}/mqdefault.jpg`] : [];
}

/* Candidate cover URLs for a listen ListenBrainz has not mapped yet (playing
   now), most authoritative first; each is probed until one loads. MusicBrainz
   is asked first and politely; iTunes only when it has nothing. */
async function searchArt(listen) {
  const sources = [listenbrainzMatchArt, musicbrainzArt, itunesArt];
  for (const find of sources) {
    const urls = await find(listen).catch(() => []);
    const hit = await firstLoadable(urls);
    if (hit) return hit;
  }
  return firstLoadable(youtubeArt(listen));
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
  // No onerror handler: a failed socket closes itself and onclose takes over.
  // Closing it again from onerror only makes Safari log a spurious error.
  ws.onclose = () => {
    clearTimeout(watchdog);
    handlers.onClose();
  };
  return ws;
}

/* One per user on the page, shared by every card showing that user. Owns the
   polling, the feed socket, the art lookups and the sessionStorage snapshot,
   and hands subscribers a snapshot { state, live, listen, recent } plus the
   feed mode whenever either changes. */
function createSource(user) {
  const base = API + encodeURIComponent(user);
  const cacheKey = `listenbrainz:${user}`;
  const subscribers = new Set();
  const art = new Map(); // track key -> Promise<{ url, tint }>, both nullable
  let snapshot = { state: "loading" };
  let failing = false; // inside an API outage
  let feedMode = "poll";
  let endGuess = null; // when the live track should be over (ms epoch)
  let timer = null;
  let feed = null;
  let feedTimer = null;
  let feedRetry = FEED_RETRY_MS[0];

  function emit() {
    for (const fn of subscribers) fn(snapshot, feedMode);
  }

  /* ListenBrainz's own mapping arrives once a listen is finished; it always
     wins, replacing an earlier guess or a cached "no cover" for that track. */
  function artFor(listen, recent) {
    const key = trackKey(listen);
    const mapped = mappedArt(listen) || (recent && trackKey(recent) === key ? mappedArt(recent) : null);
    const known = art.get(key);
    if (!known || (mapped && known.mapped !== mapped)) {
      const promise = (async () => {
        const url = mapped || await searchArt(listen).catch(() => null);
        const tint = url ? await sampleTint(url) : null;
        return { url, tint };
      })();
      promise.mapped = mapped;
      art.set(key, promise);
      promise.then(writeCache); // the snapshot carries the art once known
    }
    return art.get(key);
  }

  function readCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey));
      if (c && c.listen && Date.now() - c.at < CACHE_MS) return c;
    } catch { /* storage unavailable or stale shape */ }
    return null;
  }

  async function writeCache() {
    if (!snapshot.listen) return;
    const key = trackKey(snapshot.listen);
    const resolved = art.has(key) ? await art.get(key) : null;
    try {
      const { live, listen, recent } = snapshot;
      sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), live, listen, recent, art: resolved }));
    } catch { /* private mode, quota - the cache is only a nicety */ }
  }

  function show(listen, live, recent, seenAt = Date.now()) {
    const key = trackKey(listen);
    const changed = !snapshot.listen || trackKey(snapshot.listen) !== key;
    if (changed) {
      // Upper bound: the track was at most this far from its end when first seen.
      const ms = live ? durationMs(listen) : null;
      endGuess = ms ? seenAt + ms : null;
    } else if (!live) {
      endGuess = null;
    }
    // Until when the track can still be playing, for when the API goes quiet.
    const liveUntil = live ? seenAt + (durationMs(listen) ?? UNKNOWN_LENGTH_MS) : null;
    snapshot = { state: live ? "playing" : "idle", live, listen, recent, liveUntil };
    artFor(listen, recent);
    emit();
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
      if (live) show(live, true, recent);
      else if (recent) show(recent, false, null);
      else {
        snapshot = { state: "empty" };
        emit();
      }
      schedule();
      if (failing) console.info("listenbrainz: API reachable again");
      failing = false;
    } catch (err) {
      // One warning per outage, not one per retry.
      if (!failing) console.warn("listenbrainz: API unreachable, retrying in the background", err);
      failing = true;
      if (!snapshot.listen) {
        snapshot = { state: "error" };
        emit();
      } else if (snapshot.live && Date.now() > snapshot.liveUntil) {
        // The API is down and the track must be over by now: stop claiming
        // it is playing, keep it as the last thing heard.
        snapshot = { ...snapshot, state: "idle", live: false };
        emit();
      }
      schedule(RETRY_MS);
    }
  }

  /* Next check: the safety cadence, or sooner if the live track should end first. */
  function schedule(override) {
    clearTimeout(timer);
    timer = null;
    if (document.visibilityState !== "visible") return;
    let delay = override ?? (feedMode === "live" ? SAFETY_MS : POLL_MS);
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
        feedMode = "live";
        feedRetry = FEED_RETRY_MS[0];
        emit();
        schedule();
      },
      onEvent(event) {
        if (event === "playing_now" || event === "listen") bump();
      },
      onClose() {
        feed = null;
        feedMode = "poll";
        emit();
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
    if (cached.art && typeof cached.art === "object") {
      const promise = Promise.resolve(cached.art);
      promise.mapped = mappedArt(cached.listen) || (cached.recent ? mappedArt(cached.recent) : null);
      art.set(trackKey(cached.listen), promise);
    }
    show(cached.listen, cached.live, cached.recent, cached.at);
  }
  poll();
  connectFeed();

  return {
    subscribe(fn) {
      subscribers.add(fn);
      fn(snapshot, feedMode);
    },
    artFor,
  };
}

const sources = new Map();

function mount(root) {
  const user = root.dataset.listenbrainzUser;
  const cover = root.querySelector(".listenbrainz__cover");
  const backdrop = root.querySelector(".listenbrainz__backdrop"); // backdrop variant only
  const label = root.querySelector(".listenbrainz__label");
  const track = root.querySelector(".listenbrainz__track");
  const artist = root.querySelector(".listenbrainz__artist");
  const release = root.querySelector(".listenbrainz__release");
  let shownKey = null;
  let swap = 0; // bumps on every text swap, so a stale timeout does not fill in
  let incoming = null; // cover URL being preloaded for a crossfade
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  cover.addEventListener("error", () => root.classList.remove("has-art"));
  cover.addEventListener("load", () => root.classList.add("has-art"));

  /* Crossfade between tracks: a copy of the outgoing image stays on top and
     fades away (.listenbrainz__ghost) over the incoming one, which is loaded
     before it is shown, so the card never drops to the placeholder disc. */
  function ghost(img) {
    if (!img?.getAttribute("src")) return;
    const copy = img.cloneNode();
    copy.classList.add("listenbrainz__ghost");
    copy.setAttribute("aria-hidden", "true");
    copy.addEventListener("animationend", () => copy.remove(), { once: true });
    setTimeout(() => copy.remove(), 1_000); // background tabs never end the animation
    img.after(copy);
  }

  async function showArt({ url, tint }) {
    if (!url) {
      root.classList.remove("has-art");
      cover.removeAttribute("src");
      backdrop?.removeAttribute("src");
    } else if (cover.getAttribute("src") !== url && incoming !== url) {
      const key = shownKey;
      const crossfade = root.classList.contains("has-art") && !calm.matches;
      if (crossfade) {
        // onload rather than decode(): decode() never settles in a background
        // tab, and the image is cached and cheap to paint once it has loaded.
        incoming = url; // later updates for the same cover wait for this one
        const loaded = await new Promise((resolve) => {
          const next = new Image();
          next.onload = () => resolve(true);
          next.onerror = () => resolve(false);
          next.src = url;
        });
        if (incoming === url) incoming = null;
        if (!loaded) return; // unloadable: keep the old cover rather than show a gap
        if (shownKey !== key) return; // the track changed while loading
        ghost(cover);
        ghost(backdrop);
      } else {
        root.classList.remove("has-art");
      }
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
  }

  if (!sources.has(user)) sources.set(user, createSource(user));
  const source = sources.get(user);

  source.subscribe((snap, feedMode) => {
    root.dataset.listenbrainzFeed = feedMode;
    root.dataset.listenbrainzState = snap.state;
    if (!snap.listen) {
      if (snap.state === "error") label.textContent = "Offline";
      return; // loading / empty / error: keep the fallback markup
    }
    const t = snap.listen.track_metadata;
    const info = t.additional_info || {};
    // A playing-now listen has no listened_at; demoted during an outage it is
    // simply the last thing heard.
    label.textContent = snap.live
      ? "Now playing"
      : snap.listen.listened_at ? `Last played ${ago(snap.listen.listened_at)}` : "Recently played";

    const key = trackKey(snap.listen);
    // Every snapshot re-asks: cached, it costs nothing, and a cover ListenBrainz
    // mapped after the track ended replaces the earlier guess or gap.
    source.artFor(snap.listen, snap.recent).then((resolved) => {
      if (shownKey === key) showArt(resolved); // else the track changed meanwhile
    });
    if (key === shownKey) return;
    const first = shownKey === null; // replacing the no-JS fallback: no fade
    shownKey = key;

    const fill = () => {
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
      root.classList.remove("is-swapping");
    };
    const mine = ++swap;
    if (first || calm.matches) {
      fill();
    } else {
      // Fade the old lines out (CSS, 180 ms), swap, and let them fade back in.
      root.classList.add("is-swapping");
      setTimeout(() => mine === swap && fill(), 180);
    }
  });
}

document.querySelectorAll("[data-listenbrainz-user]").forEach(mount);
