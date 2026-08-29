// =============================================================
//  Travel — Google Maps 代理（Supabase Edge Function）
//
//  為什麼要有這一層：
//   1. API key 不能進前端。放進 index.html 等於公開，會被人拿去刷。
//   2. iPhone 的 Google 地圖分享出來一定是 maps.app.goo.gl 短網址，
//      瀏覽器受 CORS 限制展不開，只有伺服器端 fetch 才跟得到最終網址。
//
//  誰可以呼叫：帶得出正確 code + auth_hash 的人（也就是知道旅程密碼的人）。
//  verify_jwt 關掉，因為這支 app 沒有帳號系統；驗證改由旅程本身負責。
//
//  需要的密鑰（Supabase → Edge Functions → Secrets）：
//    GOOGLE_MAPS_API_KEY   ← 你自己申請的，設好 API 限制與每日上限
//  以下兩個是 Supabase 自動注入的，不用自己設：
//    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// =============================================================

const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://jeremyl861225.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

// ---------- 旅程驗證 ----------
async function authTrip(code: string, authHash: string): Promise<boolean> {
  if (!code || !authHash || !SB_URL || !SB_SERVICE) return false;
  const r = await fetch(`${SB_URL}/rest/v1/rpc/travel_open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
    },
    body: JSON.stringify({ p_code: code, p_auth_hash: authHash }),
  });
  if (!r.ok) return false;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) && rows.length > 0;
}

// ---------- Google 地圖網址解析 ----------
type Parsed = { name?: string; lat?: number; lng?: number; placeId?: string };

async function expandShortLink(url: string): Promise<string> {
  // maps.app.goo.gl / goo.gl/maps 都要跟到底才看得到真正的地點。
  // 用桌面版 UA，手機 UA 會被導去 App Store 的中介頁。
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9",
    },
  });
  return r.url || url;
}

function parseMapsUrl(raw: string): Parsed {
  const out: Parsed = {};
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return out;
  }

  // 1) 明確帶 place_id 的形式：?q=place_id:ChIJ...
  const q = u.searchParams.get("q") ?? "";
  const pidInQ = q.match(/place_id:([A-Za-z0-9_\-]+)/);
  if (pidInQ) out.placeId = pidInQ[1];
  const pidParam = u.searchParams.get("place_id");
  if (pidParam) out.placeId = pidParam;

  // 2) /maps/place/<名稱>/@lat,lng,zoom/data=...
  const mPlace = u.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (mPlace) {
    try {
      out.name = decodeURIComponent(mPlace[1].replace(/\+/g, " "));
    } catch {
      out.name = mPlace[1].replace(/\+/g, " ");
    }
  }
  const mSearch = u.pathname.match(/\/maps\/search\/([^/@]+)/);
  if (!out.name && mSearch) {
    try {
      out.name = decodeURIComponent(mSearch[1].replace(/\+/g, " "));
    } catch {
      out.name = mSearch[1].replace(/\+/g, " ");
    }
  }
  if (!out.name && q && !pidInQ) out.name = q;

  // 3) 座標。data= 裡的 !3d!4d 才是地點本身；
  //    @ 後面那組是地圖視窗中心，兩者可以差好幾百公尺，優先取前者。
  const data = u.pathname + u.search;
  const m34 = data.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m34) {
    out.lat = parseFloat(m34[1]);
    out.lng = parseFloat(m34[2]);
  } else {
    const mAt = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (mAt) {
      out.lat = parseFloat(mAt[1]);
      out.lng = parseFloat(mAt[2]);
    }
  }

  // 4) data= 裡的 !1s0x...:0x... 是 ftid，不是 place_id，不能直接查，
  //    但 !1s 後面若是 ChIJ 開頭就真的是 place_id。
  const mPid = data.match(/!1s(ChIJ[A-Za-z0-9_\-]+)/);
  if (mPid && !out.placeId) out.placeId = mPid[1];

  return out;
}

// ---------- Places API (New) ----------
const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "location",
  "internationalPhoneNumber",
  "nationalPhoneNumber",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "websiteUri",
  "googleMapsUri",
  "primaryTypeDisplayName",
  "utcOffsetMinutes",
].join(",");

function shapePlace(p: Record<string, unknown>) {
  const loc = (p.location ?? {}) as { latitude?: number; longitude?: number };
  const hours = (p.regularOpeningHours ?? {}) as {
    weekdayDescriptions?: string[];
    openNow?: boolean;
    periods?: unknown;
  };
  return {
    placeId: p.id ?? null,
    name: (p.displayName as { text?: string })?.text ?? null,
    address: p.formattedAddress ?? p.shortFormattedAddress ?? null,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
    lat: loc.latitude ?? null,
    lng: loc.longitude ?? null,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    // weekdayDescriptions 是「星期一: 09:00–18:00」這種現成字串，
    // periods 是可運算的結構，兩個都要：前者給人看，後者拿來比對到達時間。
    hoursText: hours.weekdayDescriptions ?? null,
    hoursPeriods: hours.periods ?? null,
    website: p.websiteUri ?? null,
    mapsUri: p.googleMapsUri ?? null,
    type: (p.primaryTypeDisplayName as { text?: string })?.text ?? null,
    utcOffsetMinutes: p.utcOffsetMinutes ?? null,
  };
}

async function placeDetails(placeId: string, lang: string) {
  const r = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${lang}`,
    { headers: { "X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": PLACE_FIELDS } },
  );
  if (!r.ok) return null;
  return shapePlace(await r.json());
}

async function placeSearch(text: string, lat?: number, lng?: number, lang = "zh-TW") {
  const body: Record<string, unknown> = { textQuery: text, languageCode: lang, maxResultCount: 1 };
  if (typeof lat === "number" && typeof lng === "number") {
    // 同名的店全世界都有，沒有這個偏置會抓到別的國家那一家。
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
  }
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": PLACE_FIELDS.split(",").map((f) => `places.${f}`).join(","),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const first = j?.places?.[0];
  return first ? shapePlace(first) : null;
}

// ---------- Routes API ----------
const MODES: Record<string, string> = {
  drive: "DRIVE",
  transit: "TRANSIT",
  walk: "WALK",
  bicycle: "BICYCLE",
};

async function computeRoute(
  o: { lat: number; lng: number },
  d: { lat: number; lng: number },
  mode: string,
  departAt?: string,
) {
  const travelMode = MODES[mode] ?? "DRIVE";
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    travelMode,
    languageCode: "zh-TW",
    units: "METRIC",
  };
  // 大眾運輸沒有出發時間就查不到班次；開車給了出發時間才會算路況。
  if (departAt) body.departureTime = departAt;
  if (travelMode === "DRIVE") body.routingPreference = departAt ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE";

  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { seconds: null, meters: null, error: `HTTP_${r.status}` };
  const j = await r.json();
  const route = j?.routes?.[0];
  if (!route) return { seconds: null, meters: null, error: "NO_ROUTE" };
  // duration 回來的是 "1234s" 這種字串，不是數字。
  const secs = typeof route.duration === "string" ? parseInt(route.duration, 10) : null;
  return { seconds: Number.isFinite(secs) ? secs : null, meters: route.distanceMeters ?? null };
}

// ---------- 入口 ----------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "BAD_JSON" }, 400, origin);
  }

  const code = String(body.code ?? "");
  const authHash = String(body.authHash ?? "");
  if (!(await authTrip(code, authHash))) return json({ error: "AUTH_FAILED" }, 401, origin);

  // key 沒設不是壞掉，是還沒設定：前端收到這個就切回手動填寫，不整頁失效。
  if (!GOOGLE_KEY) return json({ error: "NO_API_KEY" }, 503, origin);

  const op = String(body.op ?? "");
  const lang = String(body.lang ?? "zh-TW");

  try {
    if (op === "resolve") {
      let url = String(body.url ?? "").trim();
      const query = String(body.query ?? "").trim();
      let parsed: Parsed = {};

      if (url) {
        if (/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url)) {
          url = await expandShortLink(url.startsWith("http") ? url : `https://${url}`);
        }
        parsed = parseMapsUrl(url);
      }

      const text = query || parsed.name || "";
      let place = null;
      if (parsed.placeId) place = await placeDetails(parsed.placeId, lang);
      if (!place && text) place = await placeSearch(text, parsed.lat, parsed.lng, lang);
      if (!place && parsed.lat != null && parsed.lng != null) {
        // 連名字都解析不出來時，至少把座標交回去，讓使用者手打名稱。
        return json({
          partial: true,
          place: { name: parsed.name ?? null, lat: parsed.lat, lng: parsed.lng, mapsUri: url || null },
        }, 200, origin);
      }
      if (!place) return json({ error: "NOT_FOUND", parsed }, 404, origin);
      return json({ place }, 200, origin);
    }

    if (op === "route") {
      const o = body.origin as { lat: number; lng: number };
      const d = body.destination as { lat: number; lng: number };
      if (!o || !d) return json({ error: "MISSING_POINTS" }, 400, origin);
      const res = await computeRoute(o, d, String(body.mode ?? "drive"), body.departAt as string | undefined);
      return json(res, 200, origin);
    }

    if (op === "route_batch") {
      const legs = (body.legs ?? []) as Array<{
        origin: { lat: number; lng: number };
        destination: { lat: number; lng: number };
        mode?: string;
        departAt?: string;
      }>;
      // 一天十幾站就是十幾段；設上限免得一次請求把額度吃掉。
      if (legs.length > 24) return json({ error: "TOO_MANY_LEGS" }, 400, origin);
      const out = await Promise.all(
        legs.map((l) => computeRoute(l.origin, l.destination, l.mode ?? "drive", l.departAt)),
      );
      return json({ legs: out }, 200, origin);
    }

    return json({ error: "UNKNOWN_OP" }, 400, origin);
  } catch (e) {
    return json({ error: "UPSTREAM_FAILED", detail: String(e) }, 502, origin);
  }
});
