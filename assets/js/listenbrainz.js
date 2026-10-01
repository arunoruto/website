/* Drives the card rendered by layouts/shortcodes/listenbrainz.html.

   Each poll is two GETs against api.listenbrainz.org (playing-now + the latest
   listen); the limit is 30 requests per window *per client IP*, so a 30 s cadence
   per visitor is nowhere near it. Polling pauses while the tab is hidden.

   Cover art: ListenBrainz resolves finished listens to MusicBrainz ids and hands
   back a Cover Art Archive id with them, but a playing-now listen has no mapping
   yet. The listen that was just submitted is usually the same track, so its art
   is reused; otherwise a single MusicBrainz release-group search fills the gap.
   Results are cached per track so re-polls cost nothing. */

const API = "https://api.listenbrainz.org/1/user/";
const POLL_MS = 30_000;
const RETRY_MS = 90_000;

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

function trackKey(listen) {
  const t = listen.track_metadata;
  return [t.artist_name, t.release_name, t.track_name].map((s) => (s || "").toLowerCase()).join("\u0000");
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

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(unixSeconds) {
  const delta = Math.round((unixSeconds * 1000 - Date.now()) / 1000);
  const units = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(delta) >= size) return relative.format(Math.round(delta / size), unit);
  }
  return "just now";
}

function mount(root) {
  const user = root.dataset.listenbrainzUser;
  const base = API + encodeURIComponent(user);
  const cover = root.querySelector(".listenbrainz__cover");
  const label = root.querySelector(".listenbrainz__label");
  const track = root.querySelector(".listenbrainz__track");
  const artist = root.querySelector(".listenbrainz__artist");
  const release = root.querySelector(".listenbrainz__release");
  const artCache = new Map();
  let shownKey = null;
  let timer = null;

  cover.addEventListener("error", () => root.classList.remove("has-art"));
  cover.addEventListener("load", () => root.classList.add("has-art"));

  async function showArt(key, listen, recent) {
    if (!artCache.has(key)) {
      let url = mappedArt(listen);
      if (!url && recent && trackKey(recent) === key) url = mappedArt(recent);
      if (!url) url = await searchArt(listen).then(firstLoadable).catch(() => null);
      artCache.set(key, url);
    }
    const url = artCache.get(key);
    if (shownKey !== key) return; // the track changed while we were searching
    if (!url) {
      root.classList.remove("has-art");
      cover.removeAttribute("src");
    } else if (cover.getAttribute("src") !== url) {
      root.classList.remove("has-art");
      cover.src = url;
    }
  }

  function render(listen, live, recent) {
    const t = listen.track_metadata;
    const info = t.additional_info || {};
    const key = trackKey(listen);

    root.dataset.listenbrainzState = live ? "playing" : "idle";
    label.textContent = live ? "Now playing" : `Last played ${ago(listen.listened_at)}`;

    if (key !== shownKey) {
      shownKey = key;
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
    }
  }

  async function poll() {
    timer = null;
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
      schedule(POLL_MS);
    } catch (err) {
      console.warn("listenbrainz:", err);
      if (shownKey === null) root.dataset.listenbrainzState = "error";
      schedule(RETRY_MS);
    }
  }

  function schedule(ms) {
    if (document.visibilityState === "visible") timer = setTimeout(poll, ms);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!timer) poll();
    } else {
      clearTimeout(timer);
      timer = null;
    }
  });

  poll();
}

document.querySelectorAll("[data-listenbrainz-user]").forEach(mount);
