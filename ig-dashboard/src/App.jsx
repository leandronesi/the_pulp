import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { DayPicker } from "react-day-picker";
import { it } from "date-fns/locale";
import "react-day-picker/dist/style.css";
import {
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  Cell as BarCell,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import {
  Users,
  UserPlus,
  Eye,
  TrendingUp,
  Heart,
  Bookmark,
  Calendar,
  RefreshCw,
  AlertCircle,
  Film,
  BarChart3,
  Sparkles,
  Activity,
  Share2,
  Clock,
  Globe2,
  Info,
  Image as ImageIcon,
  LayoutDashboard,
  Grid3x3,
  UsersRound,
  CircleDot,
  MessageCircle,
} from "lucide-react";
import { TOKEN, PAGE_ID, API } from "./config.js";
import { generateFakeData, isFakeToken } from "./fakeData.js";
import {
  CURVE_TYPE_META,
  benchmarkTier,
  deriveContentMix,
  derivePostAnalytics,
  deriveScatterMeta,
  isVideoLikeMedia,
  metricOf,
  postInteractions,
  resolveMediaType,
} from "./analytics.js";
import Chat from "./Chat.jsx";

// Chat agent solo in dev (dipende dal middleware /api/chat che non esiste
// nel build statico). Se vuoi forzare off in dev metti VITE_CHAT_DISABLED=true.
const CHAT_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_CHAT_DISABLED !== "true";

// Static mode: il build è stato generato dal workflow publish-dashboard (GH Pages).
// I dati vengono da /data.json pre-generato invece che chiamare Graph API.
const STATIC_MODE = import.meta.env.VITE_USE_STATIC === "true";
// Fake mode solo se NON siamo in static (su CI il config.js viene stubbato con
// TOKEN="" ma i dati sono reali dal JSON pre-renderato).
const FAKE_MODE = !STATIC_MODE && isFakeToken(TOKEN);
// BASE_URL è "/" in dev e "/the_pulp/" sul deploy GH Pages — lo usiamo per
// prefissare gli asset statici referenziati da JSX (Vite non rewrite le
// stringhe runtime, solo quelle in index.html).
const ASSET = (p) => `${import.meta.env.BASE_URL || "/"}${p.replace(/^\//, "")}`;

// Calcolo client-side dei totali su un range arbitrario, dai daily_snapshot
// esportati nel data.json. Usato in static mode quando l'utente sceglie un
// range custom (i 3 preset usano i ranges precomputati lato workflow).
//
// Caveat: reach e accounts_engaged sono "unique users" lato IG. Sommarli per
// giorno sovrastima rispetto al "unique della finestra" che IG ritornerebbe
// (un utente attivo in 2 giorni conta 2). Per total_interactions / profile_views
// / website_clicks la somma è esatta. Etichettato con "*" nella UI.
function computeTotalsFromDaily(daily, sinceUnixSec, untilUnixSec) {
  const sinceMs = sinceUnixSec * 1000;
  const untilMs = untilUnixSec * 1000;
  const out = {
    reach: 0,
    profile_views: 0,
    website_clicks: 0,
    accounts_engaged: 0,
    total_interactions: 0,
  };
  for (const d of daily || []) {
    const t = new Date(`${d.date}T00:00:00Z`).getTime();
    if (t < sinceMs || t > untilMs) continue;
    out.reach += d.reach || 0;
    out.profile_views += d.profile_views || 0;
    out.website_clicks += d.website_clicks || 0;
    out.accounts_engaged += d.engaged || 0;
    out.total_interactions += d.interactions || 0;
  }
  return out;
}

function filterReachDaily(daily, sinceUnixSec, untilUnixSec) {
  const sinceMs = sinceUnixSec * 1000;
  const untilMs = untilUnixSec * 1000;
  return (daily || [])
    .filter((d) => {
      const t = new Date(`${d.date}T00:00:00Z`).getTime();
      return t >= sinceMs && t <= untilMs;
    })
    .map((d) => ({
      value: d.reach || 0,
      end_time: `${d.date}T00:00:00+0000`,
    }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("it-IT");
};

const fmtPct = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(1) + "%";
};

const fmtSignedPct = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });

// Palette pallini-post sul chart Reach: un colore per tipo di contenuto.
// Ricalca la palette brand (gold = formato di punta, sage = secondario, ecc).
const POST_DOT_COLORS = {
  REELS: "#D4A85C",
  CAROUSEL_ALBUM: "#7FB3A3",
  IMAGE: "#EDE5D0",
  VIDEO: "#D98B6F",
};
const POST_DOT_LABELS = {
  REELS: "Reel",
  CAROUSEL_ALBUM: "Carosello",
  IMAGE: "Foto",
  VIDEO: "Video",
};

const daysAgoTs = (n) => Math.floor((Date.now() - n * 86400000) / 1000);

const delta = (cur, prev) => {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
};

const MEDIA_TYPE_LABELS = {
  REELS: "Reels",
  VIDEO: "Video",
  IMAGE: "Foto",
  CAROUSEL_ALBUM: "Carousel",
};

const MEDIA_TYPE_COLORS = {
  REELS: "#EDE5D0",
  VIDEO: "#B8823A",
  IMAGE: "#D4A85C",
  CAROUSEL_ALBUM: "#7FB3A3",
};

const DAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const HOUR_BUCKETS = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];

// Tier IG ER — stessi valori del references/benchmarks.md della skill
// pulp-briefing. Se cambi qui, sincronizza anche la skill.
const erTier = (er) => {
  if (er == null || Number.isNaN(er)) return null;
  if (er > 6) return { label: "excellent", color: "#EDE5D0" };
  if (er >= 3) return { label: "good", color: "#7FB3A3" };
  if (er >= 1) return { label: "avg", color: "#D4A85C" };
  return { label: "poor", color: "#D98B6F" };
};

// Reach rate (reach/follower). Benchmark per-post:
// viral >100% · strong 30-100% · normal 10-30% · low <10%
const reachRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 100) return { label: "viral", color: "#EDE5D0" };
  if (rate >= 30) return { label: "strong", color: "#7FB3A3" };
  if (rate >= 10) return { label: "normal", color: "#D4A85C" };
  return { label: "low", color: "#D98B6F" };
};

// Save rate (saves/reach). In 2026 è la metrica top per qualità contenuto.
// Da benchmarks settore: >2% excellent, 1-2% good, 0.5-1% avg, <0.5% poor
const saveRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 2) return { label: "excellent", color: "#EDE5D0" };
  if (rate >= 1) return { label: "good", color: "#7FB3A3" };
  if (rate >= 0.5) return { label: "avg", color: "#D4A85C" };
  return { label: "poor", color: "#D98B6F" };
};

// Share rate (shares/reach). Indicatore "vale la pena condividere".
// >1.5% excellent, 0.5-1.5% good, <0.5% avg/poor
const shareRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 1.5) return { label: "excellent", color: "#EDE5D0" };
  if (rate >= 0.5) return { label: "good", color: "#7FB3A3" };
  return { label: "avg", color: "#D4A85C" };
};

// Tier arrays per la Legenda — stesse soglie delle funzioni sopra, ordinate
// dal peggiore al migliore (sinistra → destra nella barra).
const ER_TIERS_LEGEND = [
  { label: "poor", color: "#D98B6F", range: "<1%" },
  { label: "avg", color: "#D4A85C", range: "1–3%" },
  { label: "good", color: "#7FB3A3", range: "3–6%" },
  { label: "excellent", color: "#EDE5D0", range: ">6%" },
];
const REACH_RATE_TIERS_LEGEND = [
  { label: "low", color: "#D98B6F", range: "<10%" },
  { label: "normal", color: "#D4A85C", range: "10–30%" },
  { label: "strong", color: "#7FB3A3", range: "30–100%" },
  { label: "viral", color: "#EDE5D0", range: ">100%" },
];
const SAVE_RATE_TIERS_LEGEND = [
  { label: "poor", color: "#D98B6F", range: "<0.5%" },
  { label: "avg", color: "#D4A85C", range: "0.5–1%" },
  { label: "good", color: "#7FB3A3", range: "1–2%" },
  { label: "excellent", color: "#EDE5D0", range: ">2%" },
];
const SHARE_RATE_TIERS_LEGEND = [
  { label: "avg", color: "#D4A85C", range: "<0.5%" },
  { label: "good", color: "#7FB3A3", range: "0.5–1.5%" },
  { label: "excellent", color: "#EDE5D0", range: ">1.5%" },
];

const CONTENT_MIX_COPY = {
  section:
    "come performano i diversi tipi di contenuto rispetto all'atteso su questo account",
  legend:
    "Benchmark = reach attesa del formato su questo account. 0% = in linea, valori positivi = sopra atteso. Reach/giorno = reach medio al giorno nei primi 7 giorni osservati.",
  avgReach:
    "Media del reach dei post di questo formato. Formula: reach totale diviso numero di post.",
  avgEr:
    "Engagement rate del formato. Formula: interazioni totali diviso reach totale x 100. Interazioni = like + commenti + salvataggi + condivisioni.",
  avgVelocity:
    "Velocita di distribuzione. Per ogni post: reach osservato diviso giorni osservati, fino a 7 giorni. Qui vedi la media del formato, espressa come reach al giorno.",
  avgBenchmark:
    "Scarto rispetto alla reach attesa per questo formato sul tuo account. 0% = in linea, +20% = sopra atteso, -20% = sotto atteso. L'atteso parte dalla reach media account corretta per tipo di contenuto.",
};

// Extract a metric value from the embedded insights array on a post
// ─── Main Component ───────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsPrev, setInsightsPrev] = useState(null);
  const [posts, setPosts] = useState([]);
  const [audience, setAudience] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  // Selezione periodo: preset (7/30/90) o custom (da/a date picker).
  // In static mode i 3 preset leggono `data.ranges[N]` (precomputato dal workflow,
  // valori IG-unique corretti); il custom calcola al volo dai daily_snapshot
  // (somma per giorno, vedi computeTotalsFromDaily — caveat sui unique).
  const [selection, setSelection] = useState({
    preset: 30,
    customFrom: null, // Date o null
    customTo: null,
  });
  const [customOpen, setCustomOpen] = useState(false);

  const isCustom = !!selection.customFrom && !!selection.customTo;

  const { days, sinceUnix, untilUnix } = useMemo(() => {
    if (isCustom) {
      const sUnix = Math.floor(selection.customFrom.getTime() / 1000);
      const uUnix = Math.floor(selection.customTo.getTime() / 1000);
      const d = Math.max(1, Math.round((uUnix - sUnix) / 86400));
      return { days: d, sinceUnix: sUnix, untilUnix: uUnix };
    }
    const uUnix = Math.floor(Date.now() / 1000);
    const sUnix = uUnix - selection.preset * 86400;
    return { days: selection.preset, sinceUnix: sUnix, untilUnix: uUnix };
  }, [isCustom, selection]);

  const dateRange = days; // retrocompat nei label/memo

  const setPreset = (p) => {
    setSelection({ preset: p, customFrom: null, customTo: null });
    setCustomOpen(false);
  };

  const setCustom = (from, to) => {
    if (!from || !to) return;
    const f = from instanceof Date ? from : new Date(from);
    const t = to instanceof Date ? to : new Date(to);
    if (isNaN(f) || isNaN(t) || f >= t) return;
    setSelection({ preset: null, customFrom: f, customTo: t });
  };
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortMode, setSortMode] = useState("reach");
  const [staticData, setStaticData] = useState(null);
  const [postHistory, setPostHistory] = useState({});
  const [followerTrend, setFollowerTrend] = useState([]);
  const [stories, setStories] = useState([]);
  const [storyHistory, setStoryHistory] = useState({});

  // Tab attiva — sync con URL hash per deep linking + F5 safe.
  // Valori validi: "overview", "posts", "audience".
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "overview";
    const h = window.location.hash.replace("#", "");
    return ["overview", "posts", "stories", "audience"].includes(h) ? h : "overview";
  });

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (["overview", "posts", "stories", "audience"].includes(h)) setActiveTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const changeTab = (t) => {
    setActiveTab(t);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${t}`);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const warns = [];

      // Static mode: dati pre-generati da scripts/export-json.js (deploy pubblico).
      // Fetch JSON una sola volta, poi cambi di dateRange usano la cache.
      if (STATIC_MODE) {
        try {
          let data = staticData;
          if (!data) {
            const res = await fetch(
              (import.meta.env.BASE_URL || "/") + "data.json"
            );
            data = await res.json();
            setStaticData(data);
          }
          setAccount(data.profile);
          setPosts(data.posts || []);
          setAudience(data.audience);
          setPostHistory(data.postHistory || {});
          setStories(data.stories || []);
          setStoryHistory(data.storyHistory || {});
          const daily = data.followerTrend || [];
          setFollowerTrend(daily);

          // Preset 7/30/90 → valori IG-unique precomputati (corretti).
          // Custom → somma per giorno dai daily_snapshot (approssimazione).
          const preset = selection.preset;
          if (preset && data.ranges?.[preset]) {
            const range = data.ranges[preset];
            setInsights({
              totals: range.totals || {},
              reachDaily: range.reachDaily || [],
            });
            setInsightsPrev({ totals: range.totalsPrev || {} });
            setWarnings(range.warnings || []);
          } else {
            const span = untilUnix - sinceUnix;
            setInsights({
              totals: computeTotalsFromDaily(daily, sinceUnix, untilUnix),
              reachDaily: filterReachDaily(daily, sinceUnix, untilUnix),
            });
            setInsightsPrev({
              totals: computeTotalsFromDaily(
                daily,
                sinceUnix - span,
                sinceUnix
              ),
            });
            setWarnings([]);
          }
        } catch (e) {
          setError(`Impossibile caricare data.json: ${e.message}`);
        } finally {
          setLoading(false);
        }
        return;
      }

      // Demo mode: TOKEN vuoto → dati fake, niente fetch.
      if (FAKE_MODE) {
        const fake = generateFakeData(dateRange);
        setAccount(fake.account);
        setInsights({ totals: fake.totals, reachDaily: fake.reachDaily });
        setInsightsPrev({ totals: fake.totalsPrev });
        setPosts(fake.posts);
        setAudience(fake.audience);
        setPostHistory(fake.postHistory || {});
        setFollowerTrend(fake.followerTrend || []);
        setWarnings([]);
        setLoading(false);
        return;
      }

      try {
        // Step 1: risolvi l'IG Business Account ID dalla Page FB
        const pageUrl = `${API}/${PAGE_ID}?fields=instagram_business_account&access_token=${TOKEN}`;
        const pageData = await fetch(pageUrl).then((r) => r.json());
        if (pageData.error)
          throw new Error(`Page resolve: ${pageData.error.message}`);
        const igUserId = pageData.instagram_business_account?.id;
        if (!igUserId)
          throw new Error(
            "Nessun Instagram Business Account collegato alla Page"
          );

        // Step 2: profile
        const profileUrl = `${API}/${igUserId}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count&access_token=${TOKEN}`;
        const pRes = await fetch(profileUrl);
        const pData = await pRes.json();
        if (pData.error) throw new Error(`Profile: ${pData.error.message}`);
        setAccount(pData);

        const since = sinceUnix;
        const until = untilUnix;
        const span = until - since;
        const sincePrev = since - span;
        const untilPrev = since;

        const metrics = [
          "reach",
          "profile_views",
          "website_clicks",
          "accounts_engaged",
          "total_interactions",
        ];

        const fetchTotals = async (s, u, tag) => {
          const out = {};
          await Promise.all(
            metrics.map(async (m) => {
              try {
                const url = `${API}/${igUserId}/insights?metric=${m}&metric_type=total_value&period=day&since=${s}&until=${u}&access_token=${TOKEN}`;
                const r = await fetch(url);
                const j = await r.json();
                if (j.error) {
                  if (tag === "cur") warns.push(`${m}: ${j.error.message}`);
                  out[m] = null;
                } else {
                  out[m] = j.data?.[0]?.total_value?.value ?? 0;
                }
              } catch (e) {
                if (tag === "cur") warns.push(`${m}: ${e.message}`);
                out[m] = null;
              }
            })
          );
          return out;
        };

        const [totals, totalsPrev] = await Promise.all([
          fetchTotals(since, until, "cur"),
          fetchTotals(sincePrev, untilPrev, "prev"),
        ]);

        // Reach daily time series (current period)
        let reachDaily = [];
        try {
          const url = `${API}/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${TOKEN}`;
          const r = await fetch(url);
          const j = await r.json();
          if (!j.error) reachDaily = j.data?.[0]?.values || [];
          else warns.push(`reach daily: ${j.error.message}`);
        } catch (e) {
          warns.push(`reach daily: ${e.message}`);
        }

        setInsights({ totals, reachDaily });
        setInsightsPrev({ totals: totalsPrev });

        // Media + per-post insights
        const mediaFields =
          "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";
        const mediaUrl = `${API}/${igUserId}/media?fields=${mediaFields}&limit=30&access_token=${TOKEN}`;
        const mRes = await fetch(mediaUrl);
        const mData = await mRes.json();
        if (mData.error) {
          warns.push(`media insights: ${mData.error.message}`);
          const fallback = await fetch(
            `${API}/${igUserId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=30&access_token=${TOKEN}`
          ).then((r) => r.json());
          setPosts(fallback.data || []);
        } else {
          setPosts(mData.data || []);
        }

        // Audience demographics (lifetime breakdowns). Silenzioso: quasi tutti
        // gli account sotto i 100 follower engaged ricevono errore — non è un
        // warning da esibire, semplicemente la sezione non compare.
        const audienceOut = {};
        const breakdowns = ["age", "gender", "city", "country"];
        await Promise.all(
          breakdowns.map(async (b) => {
            try {
              const url = `${API}/${igUserId}/insights?metric=follower_demographics&breakdown=${b}&period=lifetime&metric_type=total_value&access_token=${TOKEN}`;
              const r = await fetch(url);
              const j = await r.json();
              if (j.error) return;
              const results =
                j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
              audienceOut[b] = results
                .map((row) => ({
                  key: row.dimension_values?.[0] ?? "—",
                  value: row.value ?? 0,
                }))
                .filter((r) => r.value > 0);
            } catch (e) {
              // silenzioso
            }
          })
        );
        if (Object.keys(audienceOut).length > 0) setAudience(audienceOut);
        else setAudience(null);

        setWarnings(warns);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sinceUnix, untilUnix, refreshKey, staticData]);

  // ─── Derived ─────────────────────────────────────────────────────────────
  const totals = insights?.totals || {};
  const totalsPrev = insightsPrev?.totals || {};

  const engagementRate = useMemo(() => {
    if (!totals.reach || totals.total_interactions == null) return null;
    return (totals.total_interactions / totals.reach) * 100;
  }, [totals]);

  const engagementRatePrev = useMemo(() => {
    if (!totalsPrev.reach || totalsPrev.total_interactions == null) return null;
    return (totalsPrev.total_interactions / totalsPrev.reach) * 100;
  }, [totalsPrev]);

  const reachChartData = useMemo(() => {
    if (!insights?.reachDaily) return [];
    return insights.reachDaily.map((v) => ({
      date: fmtDate(v.end_time),
      reach: v.value,
    }));
  }, [insights]);

  // Posts filtrati per il range selezionato: solo i post con timestamp
  // dentro [sinceUnix, untilUnix]. Graph API /media ritorna sempre i 30 più
  // recenti, quindi se il range > 30 post fetchati possiamo avere un clip.
  // postsClippedCount ci dice se il filtro ha rimosso qualcosa per segnalare
  // il limite all'utente.
  const postsInRange = useMemo(() => {
    const sinceMs = sinceUnix * 1000;
    const untilMs = untilUnix * 1000;
    return posts.filter((p) => {
      const t = new Date(p.timestamp).getTime();
      return t >= sinceMs && t <= untilMs;
    });
  }, [posts, sinceUnix, untilUnix]);

  // Pallini-post: pre-mergiamo i post nelle righe del chart giornaliero.
  // Un solo dataset = XAxis tiene l'ordine cronologico (dataset separati
  // farebbero appendere date fuori sequenza, vedi commit precedente).
  // Per ogni giorno aggiungiamo un campo dot_<TYPE>=reach quando c'è almeno
  // un post di quel tipo, così lo Scatter di quel tipo lo plottera' sul giorno.
  const reachChartWithDots = useMemo(() => {
    if (!reachChartData.length) return [];
    const postsByDate = {};
    for (const p of postsInRange) {
      const d = fmtDate(p.timestamp);
      if (!postsByDate[d]) postsByDate[d] = [];
      postsByDate[d].push(p);
    }
    return reachChartData.map((row) => {
      const dayPosts = postsByDate[row.date] || [];
      const out = { ...row, _posts: dayPosts };
      for (const p of dayPosts) {
        const t = resolveMediaType(p);
        const key = POST_DOT_COLORS[t] ? t : "IMAGE";
        out[`dot_${key}`] = row.reach;
      }
      return out;
    });
  }, [reachChartData, postsInRange]);

  const postCountByType = useMemo(() => {
    const counts = {};
    for (const p of postsInRange) {
      const t = resolveMediaType(p);
      const key = POST_DOT_COLORS[t] ? t : "IMAGE";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [postsInRange]);

  const postsOutsideRange = posts.length - postsInRange.length;

  const postAnalyticsById = useMemo(
    () => derivePostAnalytics(posts, postHistory, account),
    [posts, postHistory, account]
  );

  const enrichedPosts = useMemo(() => {
    return postsInRange.map((p) => {
      const analytics = postAnalyticsById?.[p.id] || {};
      const mediaType = analytics.mediaType || resolveMediaType(p);
      return {
        ...p,
        media_type: mediaType,
        mediaType,
        reach: analytics.reach ?? metricOf(p, "reach"),
        saved: analytics.saved ?? metricOf(p, "saved"),
        shares: analytics.shares ?? metricOf(p, "shares"),
        views: analytics.views ?? metricOf(p, "views"),
        interactions: analytics.interactions ?? postInteractions(p),
        er: analytics.er ?? 0,
        velocity7d: analytics.velocity7d ?? null,
        saveVelocity7d: analytics.saveVelocity7d ?? null,
        benchmarkRatio: analytics.benchmarkRatio ?? null,
        benchmarkDeltaPct: analytics.benchmarkDeltaPct ?? null,
        lifecycleSeries: analytics.lifecycleSeries || [],
        curveType: analytics.curveType || "forming",
        observedDays: analytics.observedDays ?? 1,
      };
    });
  }, [postsInRange, postAnalyticsById]);

  const scatterMeta = useMemo(
    () => deriveScatterMeta(enrichedPosts),
    [enrichedPosts]
  );

  const analyzedPosts = useMemo(() => {
    return enrichedPosts.map((post) => ({
      ...post,
      quadrant: scatterMeta.byId?.[post.id]?.quadrant || "weak",
      outlierFlag: scatterMeta.byId?.[post.id]?.outlierFlag || false,
    }));
  }, [enrichedPosts, scatterMeta]);

  const sortedPosts = useMemo(() => {
    const arr = [...analyzedPosts];
    const cmp = {
      reach: (a, b) => b.reach - a.reach,
      er: (a, b) => b.er - a.er,
      saved: (a, b) => b.saved - a.saved,
      shares: (a, b) => b.shares - a.shares,
      velocity: (a, b) => (b.velocity7d || 0) - (a.velocity7d || 0),
    }[sortMode];
    arr.sort(cmp);
    return arr;
  }, [analyzedPosts, sortMode]);

  const scatterByType = useMemo(() => {
    const byType = {
      REELS: [],
      VIDEO: [],
      IMAGE: [],
      CAROUSEL_ALBUM: [],
    };
    analyzedPosts.forEach((p) => {
      const type = byType[p.mediaType] ? p.mediaType : "IMAGE";
      byType[type].push({
        x: p.reach,
        y: p.er,
        z: p.interactions,
        id: p.id,
        caption: p.caption,
        permalink: p.permalink,
        thumb: p.thumbnail_url || p.media_url,
        date: p.timestamp,
        velocity7d: p.velocity7d,
        benchmarkDeltaPct: p.benchmarkDeltaPct,
        quadrant: p.quadrant,
        outlierFlag: p.outlierFlag,
      });
    });
    return byType;
  }, [analyzedPosts]);

  const scatterOutliers = useMemo(
    () =>
      analyzedPosts
        .filter((post) => post.outlierFlag)
        .map((post) => ({
          x: post.reach,
          y: post.er,
          z: post.interactions,
          id: post.id,
        })),
    [analyzedPosts]
  );

  const contentMix = useMemo(
    () => deriveContentMix(analyzedPosts),
    [analyzedPosts]
  );

  const heatmap = useMemo(() => {
    const grid = Array(7)
      .fill(null)
      .map(() =>
        Array(6)
          .fill(null)
          .map(() => ({ count: 0, reachSum: 0 }))
      );
    analyzedPosts.forEach((p) => {
      const d = new Date(p.timestamp);
      const dow = (d.getDay() + 6) % 7; // Mon=0, Sun=6
      const bucket = Math.floor(d.getHours() / 4);
      grid[dow][bucket].count += 1;
      grid[dow][bucket].reachSum += p.reach;
    });
    let maxAvg = 0;
    for (let d = 0; d < 7; d++) {
      for (let b = 0; b < 6; b++) {
        const c = grid[d][b];
        const avg = c.count ? c.reachSum / c.count : 0;
        if (avg > maxAvg) maxAvg = avg;
      }
    }
    return { grid, maxAvg, total: analyzedPosts.length };
  }, [analyzedPosts]);

  // Nuove metriche aggregate periodo: save rate, share rate, views totali.
  // Calcolate sui post visibili (feed fetched), quindi "indicative del periodo"
  // ma non garantite allineate con total_interactions di daily_snapshot.
  const postMetricsAgg = useMemo(() => {
    if (!analyzedPosts.length) return null;
    let reachSum = 0;
    let savedSum = 0;
    let sharesSum = 0;
    let viewsSum = 0;
    let videoCount = 0;
    for (const p of analyzedPosts) {
      reachSum += p.reach;
      savedSum += p.saved;
      sharesSum += p.shares;
      if (isVideoLikeMedia(p)) {
        viewsSum += p.views;
        videoCount += 1;
      }
    }
    return {
      saveRate: reachSum > 0 ? (savedSum / reachSum) * 100 : null,
      shareRate: reachSum > 0 ? (sharesSum / reachSum) * 100 : null,
      viewsTotal: viewsSum,
      videoCount,
    };
  }, [analyzedPosts]);

  // Reach rate = reach del periodo / followers × 100
  const reachRate = useMemo(() => {
    if (!totals.reach || !account?.followers_count) return null;
    return (totals.reach / account.followers_count) * 100;
  }, [totals.reach, account?.followers_count]);

  return (
    <RTooltip.Provider delayDuration={150} skipDelayDuration={300}>
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(ellipse at top left, #164F3F 0%, #0B3A30 50%, #052019 100%)",
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,700&family=JetBrains+Mono:wght@400;600&display=swap');
        .display-font { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
        .mono-font { font-family: 'JetBrains Mono', monospace; }
        .glass {
          background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .glass:hover { border-color: rgba(255,255,255,0.15); }
        .gradient-text {
          background: linear-gradient(135deg, #EDE5D0 0%, #D4A85C 55%, #B8823A 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .grain::before {
          content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
        @keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .fadein { animation: fadein 0.6s ease both; }
      `}</style>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 relative grain">
        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between mb-8 sm:mb-10 fadein gap-5">
          <div className="flex items-start gap-3 sm:gap-5 min-w-0">
            <img
              src={ASSET("logo-mark.jpeg")}
              alt="The Pulp"
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover shrink-0 ring-1 ring-[#EDE5D0]/10"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3 text-[11px] sm:text-xs uppercase tracking-[0.24em] sm:tracking-[0.3em] text-[#EDE5D0]/70 mono-font">
                <Sparkles size={14} /> Instagram Insights
                {FAKE_MODE && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 text-[10px] tracking-normal normal-case">
                    demo · dati fake
                  </span>
                )}
              </div>
              <h1 className="display-font text-4xl sm:text-5xl md:text-6xl font-light text-white leading-[0.95] break-words">
                {account ? (
                  <>
                    <span className="italic font-light">hello,</span>{" "}
                    <span className="gradient-text font-medium">
                      @{account.username}
                    </span>
                  </>
                ) : (
                  "Loading…"
                )}
              </h1>
              {account && (
                <p className="mt-2 sm:mt-3 text-white/50 text-xs sm:text-sm mono-font leading-relaxed">
                  {account.name && <>{account.name} · </>}
                  {fmt(account.media_count)} post totali · IG Business
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-stretch sm:items-end gap-3 w-full lg:w-auto">
            <button
              onClick={() => {
                if (STATIC_MODE) setStaticData(null);
                setRefreshKey((k) => k + 1);
              }}
              className="glass px-4 py-2 rounded-full text-xs text-white/80 flex items-center justify-center gap-2 hover:text-white transition mono-font w-full sm:w-auto"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <DateRangeSelector
              selection={selection}
              isCustom={isCustom}
              customOpen={customOpen}
              setCustomOpen={setCustomOpen}
              onPreset={setPreset}
              onCustom={setCustom}
              days={days}
              sinceUnix={sinceUnix}
              untilUnix={untilUnix}
            />
          </div>
        </header>

        {error && (
          <div className="glass rounded-2xl p-5 mb-6 border-red-500/30 flex items-start gap-3">
            <AlertCircle className="text-red-400 mt-0.5" size={20} />
            <div>
              <p className="text-red-300 font-medium text-sm">Errore</p>
              <p className="text-white/60 text-xs mt-1 mono-font">{error}</p>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <details className="glass rounded-xl p-4 mb-6 text-xs">
            <summary className="text-amber-400/80 cursor-pointer mono-font">
              {warnings.length} metriche con problemi (click per dettagli)
            </summary>
            {warnings.some((w) => /#10\)|permission for this action/i.test(w)) && (
              <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-100/90 leading-relaxed">
                <p className="font-semibold mb-1">Manca lo scope <span className="mono-font">instagram_manage_insights</span> sul token.</p>
                <p className="text-white/60">
                  Rigenera lo user token dal Graph API Explorer con quello scope attivo, poi ricava il Page access token da <span className="mono-font">GET /me/accounts</span>.
                  Vedi <span className="mono-font">CLAUDE.md</span> → "Generazione token".
                </p>
              </div>
            )}
            <ul className="mt-3 space-y-1 text-white/50 mono-font">
              {warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          </details>
        )}

        {loading && !account && (
          <div className="glass rounded-3xl p-10 sm:p-20 text-center">
            <RefreshCw
              className="animate-spin mx-auto text-[#EDE5D0]"
              size={32}
            />
            <p className="mt-4 text-white/60 text-sm mono-font">
              fetching data…
            </p>
          </div>
        )}

        {account && (
          <>
            {/* Tabs bar */}
            <Tabs.Root
              value={activeTab}
              onValueChange={changeTab}
              className="mb-8 fadein"
            >
              <div className="overflow-x-auto no-scrollbar border-b border-white/5 mb-6 sm:mb-8">
                <Tabs.List className="flex items-center gap-1 min-w-max">
                  <TabTrigger value="overview" icon={<LayoutDashboard size={14} />} label="overview" />
                  <TabTrigger value="posts" icon={<Grid3x3 size={14} />} label="posts" />
                  <TabTrigger value="stories" icon={<CircleDot size={14} />} label="stories" />
                  <TabTrigger value="audience" icon={<UsersRound size={14} />} label="audience" />
                </Tabs.List>
              </div>

              <Tabs.Content value="overview" className="focus:outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-300">

            {/* Hero KPIs */}
            <section className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-4 gap-4 mb-10 fadein">
              <KpiCard
                icon={<Users size={16} />}
                label="Followers"
                value={fmt(account.followers_count)}
                sparkline={followerTrend.map((d) => ({ reach: d.followers }))}
                accent="from-[#EDE5D0] to-[#D4A85C]"
                info="Follower attuali. La piccola curva sotto mostra come il numero cambia giorno per giorno (serve ≥2 giorni di dati per apparire). La Graph API non dà lo storico: ce lo costruiamo noi."
              />
              <KpiCard
                icon={<UserPlus size={16} />}
                label="Seguiti"
                value={fmt(account.follows_count)}
                accent="from-[#D4A85C] to-[#B8823A]"
                info="Numero di account che The Pulp segue."
              />
              <KpiCard
                icon={<TrendingUp size={16} />}
                label={`Reach · ${dateRange}g`}
                value={fmt(totals.reach)}
                deltaPct={delta(totals.reach, totalsPrev.reach)}
                tier={reachRateTier(reachRate)}
                tierLabel={
                  reachRate != null
                    ? `${reachRate.toFixed(0)}% dei follower`
                    : null
                }
                accent="from-[#8FB5A3] to-[#3E7A66]"
                info={`Account UNICI che hanno visto almeno un contenuto negli ultimi ${dateRange} giorni. Un utente che vede 10 post conta 1 (dedupe automatico Meta). Il pill "X% dei follower" è il reach rate: quanto hai bucato la cerchia. Viral >100%, strong 30-100%, normal 10-30%, low <10%.`}
              />
              <KpiCard
                icon={<Activity size={16} />}
                label={`Engagement · ${dateRange}g`}
                value={fmtPct(engagementRate)}
                deltaPct={delta(engagementRate, engagementRatePrev)}
                tier={erTier(engagementRate)}
                accent="from-[#3E7A66] to-[#0E4A3E]"
                info="Engagement rate del periodo: (like + commenti + salvati + condivisioni + azioni sul profilo) / reach. Più alto = audience che interagisce di più rispetto a quanta ne raggiungi."
              />
            </section>

            {/* Rate strip — save/share/views/engaged (le metriche 2026) */}
            <section className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-4 gap-3 mb-8 fadein">
              <RateCard
                icon={<Bookmark size={14} />}
                label="Save rate"
                value={fmtPct(postMetricsAgg?.saveRate)}
                tier={saveRateTier(postMetricsAgg?.saveRate)}
                info="Saves ÷ Reach × 100. Nel 2026 Meta dà peso ~5× ai salvataggi rispetto ai like per spingere su Esplora. >2% excellent · 1–2% good · 0.5–1% avg · <0.5% poor."
              />
              <RateCard
                icon={<Share2 size={14} />}
                label="Share rate"
                value={fmtPct(postMetricsAgg?.shareRate)}
                tier={shareRateTier(postMetricsAgg?.shareRate)}
                info="Shares ÷ Reach × 100. 'Vale la pena mandarlo a qualcuno'. >1.5% excellent · 0.5–1.5% good · <0.5% avg."
              />
              <RateCard
                icon={<Film size={14} />}
                label={
                  postMetricsAgg?.videoCount
                    ? `Views · ${postMetricsAgg.videoCount} video/reel`
                    : "Views"
                }
                value={fmt(postMetricsAgg?.viewsTotal ?? 0)}
                info="Somma delle visualizzazioni su video e reel visibili. Diversa dal reach: una view conta ogni singola volta che il contenuto viene mostrato, anche allo stesso utente. Dal 2025 IG ha unificato 'impressions' in 'views'."
              />
              <RateCard
                icon={<Sparkles size={14} />}
                label="Account coinvolti"
                value={fmt(totals.accounts_engaged)}
                deltaPct={delta(
                  totals.accounts_engaged,
                  totalsPrev.accounts_engaged
                )}
                info="Utenti UNICI che hanno fatto almeno un'azione (like, commento, saved, share). Uno che mette 5 like conta 1."
              />
            </section>

            <StoriesStrip stories={stories} onJump={() => changeTab("stories")} />

            {/* Reach chart + secondary panel */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10 fadein">
              {reachChartData.length > 0 && (
                <div className="glass rounded-3xl p-5 sm:p-6 md:p-8 lg:col-span-2 flex flex-col">
                  <div className="mb-6 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3">
                    <div>
                      <h2 className="display-font text-2xl text-white font-light">
                        Reach giornaliero
                      </h2>
                      <p className="text-xs text-white/40 mono-font mt-1">
                        ultimi {dateRange} giorni
                      </p>
                    </div>
                    {reachChartData.length > 0 && (
                      <ReachTrio data={reachChartData} />
                    )}
                  </div>
                  <div className="flex-1 min-h-[240px] sm:min-h-[260px] overflow-x-auto no-scrollbar">
                    <div className="h-[240px] sm:h-[260px] min-w-[520px] sm:min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={reachChartWithDots}>
                      <defs>
                        <linearGradient
                          id="reachGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#EDE5D0"
                            stopOpacity={0.45}
                          />
                          <stop
                            offset="100%"
                            stopColor="#EDE5D0"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        stroke="rgba(255,255,255,0.3)"
                        tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                      />
                      <YAxis
                        stroke="rgba(255,255,255,0.3)"
                        tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                        tickFormatter={fmt}
                      />
                      <ZAxis range={[70, 70]} />
                      <Tooltip content={<ReachWithPostsTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="reach"
                        name="Reach"
                        stroke="#EDE5D0"
                        strokeWidth={2}
                        fill="url(#reachGrad)"
                      />
                      {Object.keys(POST_DOT_COLORS).map((type) => (
                        <Scatter
                          key={type}
                          dataKey={`dot_${type}`}
                          name={POST_DOT_LABELS[type]}
                          fill={POST_DOT_COLORS[type]}
                          stroke="#0B3A30"
                          strokeWidth={1.5}
                          isAnimationActive={false}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                    </div>
                  </div>
                  {Object.keys(postCountByType).length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] mono-font text-white/50">
                      <span className="text-white/30">post:</span>
                      {Object.entries(postCountByType).map(([type, count]) => (
                        <span
                          key={type}
                          className="flex items-center gap-1.5"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: POST_DOT_COLORS[type] }}
                          />
                          {POST_DOT_LABELS[type]} · {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="glass rounded-3xl p-5 sm:p-6 md:p-8 flex flex-col gap-4">
                <div>
                  <h2 className="display-font text-2xl text-white font-light">
                    Sintesi
                  </h2>
                  <p className="text-xs text-white/40 mono-font mt-1">
                    metriche aggregate {dateRange}g
                  </p>
                </div>
                <SummaryRow
                  icon={<Heart size={14} />}
                  label="Interazioni totali"
                  value={fmt(totals.total_interactions)}
                  deltaPct={delta(
                    totals.total_interactions,
                    totalsPrev.total_interactions
                  )}
                  info="Somma di like + commenti + salvati + condivisioni + attività sul profilo. È il numero che mette al denominatore il calcolo dell'engagement rate."
                />
                <SummaryRow
                  icon={<Eye size={14} />}
                  label="Profile views"
                  value={fmt(totals.profile_views)}
                  deltaPct={delta(totals.profile_views, totalsPrev.profile_views)}
                  info="Volte che la pagina profilo è stata aperta nel periodo (non utenti unici, non click sul bio-link)."
                />
                {totals.website_clicks > 0 && (
                  <SummaryRow
                    icon={<BarChart3 size={14} />}
                    label="Website clicks"
                    value={fmt(totals.website_clicks)}
                    deltaPct={delta(
                      totals.website_clicks,
                      totalsPrev.website_clicks
                    )}
                    info="Tap sul link in bio. Se lasci il link in bio vuoto, questo resta 0."
                  />
                )}
              </div>
            </section>
              </Tabs.Content>

              <Tabs.Content value="posts" className="focus:outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-300">

            {/* Posts scope banner */}
            <div className="mb-6 flex items-baseline gap-3 flex-wrap">
              <h2 className="display-font text-3xl text-white font-light">
                <span className="italic">post</span> nel periodo
              </h2>
              <span className="text-xs mono-font text-white/50">
                {enrichedPosts.length} post · {dateRange}g
                {postsOutsideRange > 0 && (
                  <span className="text-white/30">
                    {" · "}+{postsOutsideRange} fuori range
                  </span>
                )}
              </span>
              {postsOutsideRange > 0 && (
                <InfoTip
                  text={`Graph API ritorna sempre gli ultimi 30 post; ${postsOutsideRange} sono stati pubblicati prima del range selezionato e vengono esclusi da metriche, grafici e heatmap di questa tab.`}
                />
              )}
            </div>

            {enrichedPosts.length === 0 && (
              <div className="glass rounded-3xl p-8 sm:p-12 text-center mb-10 fadein">
                <Grid3x3 className="mx-auto text-white/30 mb-4" size={40} />
                <p className="display-font text-xl text-white/70 mb-2">
                  Nessun post nel periodo
                </p>
                <p className="text-xs text-white/40 mono-font leading-relaxed max-w-sm mx-auto">
                  Prova ad allargare il range temporale dal selettore in alto a destra, o controlla se ci sono post più vecchi fuori dai 30 fetched.
                </p>
              </div>
            )}

            {/* Content mix */}
            {enrichedPosts.length > 0 && (
              <section className="mb-10 fadein">
                <div className="flex items-baseline justify-between mb-6">
                  <div>
                    <h2 className="display-font text-3xl text-white font-light">
                      <span className="italic">content</span> mix
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      {CONTENT_MIX_COPY.section}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] mono-font text-white/55">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                        benchmark = reach attesa del formato
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                        0% = in linea
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                        reach/giorno = reach medio al giorno
                      </span>
                      <InfoTip text={CONTENT_MIX_COPY.legend} side="bottom" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                  <div className="lg:col-span-2 grid grid-cols-1 min-[520px]:grid-cols-2 gap-3">
                    {contentMix.map((m) => (
                      <ContentTypeTile key={m.type} data={m} />
                    ))}
                  </div>
                  <div className="glass rounded-3xl p-5 sm:p-6 lg:col-span-3">
                    <p className="text-xs text-white/40 mono-font mb-4 uppercase tracking-wider">
                      Reach medio per tipo
                    </p>
                    <div className="overflow-x-auto no-scrollbar">
                      <div className="min-w-[520px] h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={contentMix.filter((m) => m.count > 0)}
                        layout="vertical"
                        margin={{ left: 20 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="rgba(255,255,255,0.05)"
                        />
                        <XAxis
                          type="number"
                          stroke="rgba(255,255,255,0.3)"
                          tick={{
                            fontSize: 11,
                            fontFamily: "JetBrains Mono",
                          }}
                          tickFormatter={fmt}
                        />
                        <YAxis
                          type="category"
                          dataKey="type"
                          width={80}
                          stroke="rgba(255,255,255,0.3)"
                          tick={{
                            fontSize: 11,
                            fontFamily: "JetBrains Mono",
                          }}
                          tickFormatter={(t) => MEDIA_TYPE_LABELS[t]}
                        />
                        <Tooltip content={<DarkTooltip />} />
                        <Bar
                          dataKey="avgReach"
                          radius={[0, 6, 6, 0]}
                        >
                          {contentMix
                            .filter((m) => m.count > 0)
                            .map((m) => (
                              <BarCell
                                key={m.type}
                                fill={MEDIA_TYPE_COLORS[m.type]}
                              />
                            ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Post analysis: scatter + tabs + grid */}
            {enrichedPosts.length > 0 && (
              <section className="mb-10 fadein">
                <div className="flex items-baseline justify-between flex-wrap gap-3 mb-6">
                  <div>
                    <h2 className="display-font text-3xl text-white font-light">
                      <span className="italic">post</span> analysis
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      reach × engagement rate · quadranti mediani + outlier highlight
                    </p>
                  </div>
                  <div className="glass rounded-2xl sm:rounded-full px-2 py-1 flex flex-wrap items-center gap-1 w-full sm:w-auto">
                    {[
                      { k: "reach", label: "Reach" },
                      { k: "er", label: "Engagement" },
                      { k: "velocity", label: "Reach/g" },
                      { k: "saved", label: "Salvati" },
                      { k: "shares", label: "Shares" },
                    ].map(({ k, label }) => (
                      <button
                        key={k}
                        onClick={() => setSortMode(k)}
                        className={`px-3 py-1.5 text-xs rounded-full transition mono-font whitespace-nowrap ${
                          sortMode === k
                            ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                            : "text-white/60 hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="glass rounded-3xl p-5 sm:p-6 md:p-8 mb-6">
                  <div className="overflow-x-auto no-scrollbar">
                    <div className="min-w-[560px] h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Reach"
                        stroke="rgba(255,255,255,0.3)"
                        tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                        tickFormatter={fmt}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Engagement rate"
                        stroke="rgba(255,255,255,0.3)"
                        tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                        tickFormatter={(v) => v.toFixed(0) + "%"}
                      />
                      <ZAxis type="number" dataKey="z" range={[40, 220]} />
                      <ReferenceLine
                        x={scatterMeta.reachMedian}
                        stroke="rgba(237,229,208,0.25)"
                        strokeDasharray="4 4"
                      />
                      <ReferenceLine
                        y={scatterMeta.erMedian}
                        stroke="rgba(127,179,163,0.25)"
                        strokeDasharray="4 4"
                      />
                      <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }} />
                      {Object.entries(scatterByType).map(([type, data]) =>
                        data.length > 0 ? (
                          <Scatter
                            key={type}
                            name={MEDIA_TYPE_LABELS[type]}
                            data={data}
                            fill={MEDIA_TYPE_COLORS[type]}
                            fillOpacity={0.75}
                            stroke={MEDIA_TYPE_COLORS[type]}
                            strokeWidth={1}
                          />
                        ) : null
                      )}
                      {scatterOutliers.length > 0 && (
                        <Scatter
                          name="Outlier"
                          data={scatterOutliers}
                          fill="transparent"
                          stroke="#EDE5D0"
                          strokeWidth={2}
                        />
                      )}
                    </ScatterChart>
                  </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-4 text-[11px] mono-font text-white/60">
                    {Object.entries(MEDIA_TYPE_COLORS).map(([t, c]) =>
                      scatterByType[t]?.length ? (
                        <div key={t} className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: c }}
                          />
                          {MEDIA_TYPE_LABELS[t]}
                        </div>
                      ) : null
                    )}
                    {scatterOutliers.length > 0 && (
                      <div className="flex items-center gap-2 text-[#EDE5D0]">
                        <span className="w-2.5 h-2.5 rounded-full border border-[#EDE5D0]" />
                        outlier
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {scatterMeta.quadrants.map((quadrant) => (
                      <span
                        key={quadrant.key}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] mono-font uppercase tracking-wider"
                        style={{
                          backgroundColor: `${quadrant.color}12`,
                          color: quadrant.color,
                        }}
                      >
                        <span>{quadrant.label}</span>
                        <span className="text-white/40">{quadrant.count}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedPosts.slice(0, 12).map((p, i) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      rank={i + 1}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Best time to post */}
            {enrichedPosts.length > 0 && (
              <section className="glass rounded-3xl p-5 sm:p-6 md:p-8 mb-10 fadein">
                <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
                  <div>
                    <h2 className="display-font text-2xl text-white font-light flex items-center gap-3">
                      <Clock size={20} className="text-[#EDE5D0]/70" />
                      Best time to post
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      reach medio per giorno × fascia oraria · {heatmap.total} post nel periodo
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[520px]">
                    {/* Header hour buckets */}
                    <div
                      className="grid gap-1.5 mb-1.5"
                      style={{
                        gridTemplateColumns: "50px repeat(6, 1fr)",
                      }}
                    >
                      <div />
                      {HOUR_BUCKETS.map((h) => (
                        <div
                          key={h}
                          className="text-[10px] text-white/40 mono-font text-center"
                        >
                          {h}
                        </div>
                      ))}
                    </div>
                    {heatmap.grid.map((row, d) => (
                      <div
                        key={d}
                        className="grid gap-1.5 mb-1.5"
                        style={{
                          gridTemplateColumns: "50px repeat(6, 1fr)",
                        }}
                      >
                        <div className="text-[11px] text-white/60 mono-font flex items-center">
                          {DAYS_IT[d]}
                        </div>
                        {row.map((cell, b) => {
                          const avg = cell.count
                            ? cell.reachSum / cell.count
                            : 0;
                          const intensity = heatmap.maxAvg
                            ? avg / heatmap.maxAvg
                            : 0;
                          return (
                            <div
                              key={b}
                              className="aspect-[2/1] rounded-md relative group"
                              style={{
                                background: cell.count
                                  ? `rgba(237, 229, 208, ${0.1 + intensity * 0.7})`
                                  : "rgba(255,255,255,0.03)",
                                border:
                                  cell.count > 0
                                    ? "1px solid rgba(237, 229, 208, 0.15)"
                                    : "1px solid rgba(255,255,255,0.04)",
                              }}
                            >
                              {cell.count > 0 && (
                                <span
                                  className="absolute inset-0 flex items-center justify-center text-[10px] mono-font font-semibold"
                                  style={{
                                    color:
                                      intensity > 0.45
                                        ? "#0B3A30"
                                        : "rgba(255,255,255,0.75)",
                                  }}
                                >
                                  {cell.count}
                                </span>
                              )}
                              {cell.count > 0 && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                                  <div className="glass rounded-lg px-2 py-1 text-[10px] mono-font text-white whitespace-nowrap">
                                    {cell.count} post · reach medio{" "}
                                    {fmt(avg)}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-4 text-[11px] text-white/40 mono-font">
                  il numero è la quantità di post in quello slot · l'intensità è
                  il reach medio. Con pochi post per slot, trattare come
                  indicativo.
                </p>
              </section>
            )}
              </Tabs.Content>

              <Tabs.Content value="stories" className="focus:outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-300">
                <StoriesTab stories={stories} storyHistory={storyHistory} />
              </Tabs.Content>

              <Tabs.Content value="audience" className="focus:outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-300">

            {/* Audience — lifetime disclaimer + panels */}
            <div className="mb-6 fadein">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="display-font text-3xl text-white font-light">
                  <span className="italic">audience</span>
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider bg-[#D4A85C]/15 text-[#D4A85C]">
                  lifetime
                </span>
              </div>
              <p className="text-xs text-white/50 mono-font mt-2 leading-relaxed max-w-2xl">
                Questi dati riguardano l'intera storia dell'account, non il periodo selezionato sopra. Demografia dei follower attuali.
              </p>
            </div>

            {audience ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10 fadein">
                {audience.gender && (
                  <AudiencePanel
                    icon={<Users size={16} />}
                    title="Genere"
                    data={audience.gender}
                    colors={{
                      F: "#D4A85C",
                      M: "#7FB3A3",
                      U: "#EDE5D0",
                    }}
                    labelMap={{ F: "Donne", M: "Uomini", U: "Non spec." }}
                  />
                )}
                {audience.age && (
                  <AudiencePanel
                    icon={<Activity size={16} />}
                    title="Età"
                    data={audience.age}
                    colors={null}
                  />
                )}
                {(audience.city || audience.country) && (
                  <AudiencePanel
                    icon={<Globe2 size={16} />}
                    title={audience.city ? "Top città" : "Top paesi"}
                    data={(audience.city || audience.country).slice(0, 6)}
                    colors={null}
                  />
                )}
              </div>
            ) : (
              <div className="glass rounded-3xl p-8 sm:p-12 text-center mb-10">
                <UsersRound className="mx-auto text-white/30 mb-4" size={40} />
                <p className="display-font text-xl text-white/70 mb-2">
                  Audience non disponibile
                </p>
                <p className="text-xs text-white/40 mono-font leading-relaxed max-w-sm mx-auto">
                  Meta blocca i breakdown demografici sotto una certa soglia di follower attivi (~100). Appena superi la soglia, i dati compaiono automaticamente.
                </p>
              </div>
            )}

              </Tabs.Content>
            </Tabs.Root>

            <footer className="text-center text-white/30 text-xs mono-font pt-8 border-t border-white/5">
              {STATIC_MODE && staticData?.generatedAt
                ? `snapshot generato ${new Date(
                    staticData.generatedAt
                  ).toLocaleString("it-IT")} · facebook graph api v21`
                : FAKE_MODE
                ? "demo mode · dati fake"
                : `dati live · facebook graph api v21 · ${new Date().toLocaleString(
                    "it-IT"
                  )}`}
            </footer>
          </>
        )}
      </div>
      {CHAT_ENABLED && (
        <Chat
          account={account}
          insights={insights}
          insightsPrev={insightsPrev}
          posts={posts}
          audience={audience}
          dateRange={dateRange}
        />
      )}
    </div>
    </RTooltip.Provider>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
// InfoTip — wrapper su @radix-ui/react-tooltip.
// Radix usa Floating UI internamente → collision detection, auto-flip,
// portal automatico fuori da overflow:hidden, ARIA accessibile, supporto
// keyboard. Un ordine di grandezza meglio del nostro custom.
function InfoTip({ text, side = "top" }) {
  return (
    <RTooltip.Root delayDuration={150}>
      <RTooltip.Trigger asChild>
        <span
          className="inline-flex items-center cursor-help ml-1"
          onClick={(e) => {
            // su touch il tap attiva anche il parent; fermiamo qui
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Info
            size={10}
            className="text-white/40 hover:text-white/90 transition"
          />
        </span>
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[9999] w-60 glass rounded-lg p-2 text-[10px] mono-font text-white/85 leading-relaxed normal-case tracking-normal shadow-2xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in"
        >
          {text}
          <RTooltip.Arrow className="fill-white/10" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// DateRangeSelector — presets + range calendar via Radix Popover + react-day-picker.
// Radix Popover rende in portal con collision detection (zero z-index drama).
// Calendar stilato nel brand Pulp: Fraunces per mese, JetBrains Mono per numeri,
// cream come selected, verde per hover. Locale italiano.
// TabTrigger — trigger stilato per Radix Tabs. Underline cream sulla tab
// attiva (data-state=active), hover discreto sulle inattive.
function TabTrigger({ value, icon, label }) {
  return (
    <Tabs.Trigger
      value={value}
      className="group relative px-3 sm:px-5 py-3 text-[11px] sm:text-sm mono-font uppercase tracking-[0.14em] sm:tracking-[0.2em] text-white/40 hover:text-white/80 transition flex items-center gap-2 data-[state=active]:text-[#EDE5D0] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#EDE5D0]/40 rounded-t-lg whitespace-nowrap"
    >
      {icon}
      {label}
      <span className="absolute inset-x-4 -bottom-px h-0.5 bg-[#EDE5D0] scale-x-0 group-data-[state=active]:scale-x-100 transition-transform origin-center" />
    </Tabs.Trigger>
  );
}

// Mini-strip in Overview: invita a vedere la tab Stories.
// Niente quando l'archivio e' vuoto (account senza stories tracciate).
function StoriesStrip({ stories, onJump }) {
  const last7 = useMemo(() => {
    const cut = Date.now() - 7 * 86400000;
    return (stories || []).filter(
      (s) => new Date(s.timestamp).getTime() >= cut
    );
  }, [stories]);
  if (!last7.length) return null;
  const totalReach = last7.reduce((a, s) => a + (s.reach || 0), 0);
  const totalReplies = last7.reduce((a, s) => a + (s.replies || 0), 0);
  const replyRate = totalReach > 0 ? (totalReplies / totalReach) * 100 : 0;
  const reachAvg = totalReach / last7.length;
  return (
    <button
      onClick={onJump}
      className="glass rounded-2xl px-5 py-3 mb-10 flex items-center gap-4 text-left w-full hover:bg-white/5 transition fadein flex-wrap"
    >
      <div className="flex items-center gap-2 text-[#7FB3A3]">
        <CircleDot size={16} />
        <span className="text-[10px] mono-font tracking-wider uppercase">
          Stories ultimi 7g
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="display-font text-2xl text-white">{last7.length}</span>
        <span className="text-[10px] mono-font text-white/40 ml-1">pubblicate</span>
      </div>
      <span className="text-white/20">·</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm text-white">{Math.round(reachAvg)}</span>
        <span className="text-[10px] mono-font text-white/40">reach medio</span>
      </div>
      <span className="text-white/20">·</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm text-white">{replyRate.toFixed(1)}%</span>
        <span className="text-[10px] mono-font text-white/40">reply rate</span>
      </div>
      <span className="ml-auto text-[10px] mono-font text-white/40 hover:text-white/70">
        apri tab →
      </span>
    </button>
  );
}

// ─── Stories tab ─────────────────────────────────────────────────────────
// Stories vivono in Turso (catturate dal cron 4h prima della scadenza 24h IG).
// Mostriamo: KPI aggregati ultimi 7g + lista cronologica con curva di
// consumo durante le 24h di vita di ogni story.
function StoriesTab({ stories, storyHistory }) {
  const [windowDays, setWindowDays] = useState(7);
  const cutoffMs = Date.now() - windowDays * 86400000;
  const inWindow = stories.filter(
    (s) => new Date(s.timestamp).getTime() >= cutoffMs
  );

  const aggregates = useMemo(() => {
    if (!inWindow.length) return null;
    const totals = inWindow.reduce(
      (acc, s) => ({
        reach: acc.reach + (s.reach || 0),
        replies: acc.replies + (s.replies || 0),
        navigation: acc.navigation + (s.navigation || 0),
        shares: acc.shares + (s.shares || 0),
        interactions: acc.interactions + (s.total_interactions || 0),
      }),
      { reach: 0, replies: 0, navigation: 0, shares: 0, interactions: 0 }
    );
    const reachAvg = totals.reach / inWindow.length;
    const replyRate = totals.reach > 0 ? (totals.replies / totals.reach) * 100 : 0;
    const navRate = totals.reach > 0 ? totals.navigation / totals.reach : 0;
    const interRate = totals.reach > 0 ? (totals.interactions / totals.reach) * 100 : 0;
    return {
      count: inWindow.length,
      reachAvg,
      replyRate,
      navRate,
      interRate,
      ...totals,
    };
  }, [inWindow]);

  if (!stories.length) {
    return (
      <div className="glass rounded-3xl p-8 text-center">
        <CircleDot
          size={32}
          className="mx-auto mb-3 text-white/30"
        />
        <h3 className="display-font text-xl text-white/80 mb-2">
          Nessuna story in archivio
        </h3>
        <p className="text-xs text-white/40 mono-font max-w-md mx-auto leading-relaxed">
          Le stories vengono catturate dal cron `snapshot:fresh` ogni 4h, prima
          che IG le scada (24h). Pubblica una story e aspetta il prossimo cron
          — oppure lancia manualmente <code>npm run snapshot:fresh</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 fadein flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h2 className="display-font text-3xl text-white font-light">
            <span className="italic">stories</span>
          </h2>
          <p className="text-xs text-white/50 mono-font mt-2">
            Catturate dal cron 4h durante le 24h di vita. {inWindow.length} stories negli ultimi {windowDays}g.
          </p>
        </div>
        <div className="glass rounded-full px-2 py-1 flex items-center gap-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`px-3 py-1.5 text-xs rounded-full transition mono-font ${
                windowDays === d
                  ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {d}g
            </button>
          ))}
        </div>
      </div>

      {aggregates && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 fadein">
          <StoryKpi
            label="STORIES PUBBLICATE"
            value={aggregates.count}
            sublabel={`ultimi ${windowDays}g`}
          />
          <StoryKpi
            label="REACH MEDIO"
            value={Math.round(aggregates.reachAvg)}
            sublabel={`tot ${fmt(aggregates.reach)}`}
          />
          <StoryKpi
            label="REPLY RATE"
            value={aggregates.replyRate.toFixed(1) + "%"}
            sublabel={`${aggregates.replies} risposte / ${aggregates.reach} reach`}
            tier={
              aggregates.replyRate > 1.5
                ? { label: "forte", color: "#7FB3A3" }
                : aggregates.replyRate > 0.5
                ? { label: "medio", color: "#D4A85C" }
                : { label: "basso", color: "#D98B6F" }
            }
          />
          <StoryKpi
            label="NAVIGATION / REACH"
            value={aggregates.navRate.toFixed(2) + "×"}
            sublabel="azioni di navigazione per visione"
          />
        </section>
      )}

      <section className="space-y-3 fadein">
        {inWindow.map((s) => (
          <StoryRow key={s.id} story={s} history={storyHistory[s.id] || []} />
        ))}
      </section>

      <div className="mt-8 text-[11px] text-white/40 mono-font leading-relaxed">
        <p className="mb-1"><strong>KPI specifici stories</strong> (diversi dai post):</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li><strong>Reply rate</strong>: replies/reach × 100. Il reply via DM è high-effort, segnale forte di affinità.</li>
          <li><strong>Navigation/reach</strong>: somma di tap-forward, tap-back, swipe-forward, exits per visione. Valori &gt;1 = molto attive.</li>
          <li><strong>Total interactions</strong>: aggregato di tutte le interazioni dirette (replies + reactions + altre).</li>
        </ul>
      </div>
    </>
  );
}

function StoryKpi({ label, value, sublabel, tier }) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1">
      <div className="text-[10px] mono-font tracking-wider text-white/40 uppercase">
        {label}
      </div>
      <div className="display-font text-2xl text-white font-light">{value}</div>
      {sublabel && (
        <div className="text-[10px] mono-font text-white/40">{sublabel}</div>
      )}
      {tier && (
        <span
          className="inline-flex self-start items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider mt-1"
          style={{
            backgroundColor: tier.color + "26",
            color: tier.color,
          }}
        >
          {tier.label}
        </span>
      )}
    </div>
  );
}

function StoryRow({ story, history }) {
  const when = new Date(story.timestamp).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const hoursOld = Math.floor(
    (Date.now() - new Date(story.timestamp).getTime()) / 3600000
  );
  const isLive = hoursOld < 24;
  const replyRate =
    story.reach > 0 ? (story.replies / story.reach) * 100 : 0;
  const interRate =
    story.reach > 0 ? (story.total_interactions / story.reach) * 100 : 0;
  // Sparkline: curva del reach durante la vita della story (5-6 punti tipici).
  const spark = (history || []).filter((h) => h.reach > 0);

  return (
    <div className="glass rounded-2xl p-4 flex gap-4 items-stretch">
      <div className="w-16 h-20 sm:w-20 sm:h-24 shrink-0 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
        {story.thumbnail_url || story.media_url ? (
          <img
            src={story.thumbnail_url || story.media_url}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <CircleDot size={20} className="text-white/30" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs mono-font text-white/70">{when}</span>
          <span className="text-[10px] mono-font text-white/40 uppercase tracking-wider">
            {story.media_type}
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] mono-font uppercase tracking-wider bg-[#7FB3A3]/20 text-[#7FB3A3]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7FB3A3] animate-pulse" />
              live
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 mt-1">
          <StoryMetric label="reach" value={story.reach} />
          <StoryMetric label="replies" value={story.replies} sub={replyRate ? replyRate.toFixed(1) + "%" : null} />
          <StoryMetric label="nav" value={story.navigation} />
          <StoryMetric label="shares" value={story.shares} />
          <StoryMetric label="inter" value={story.total_interactions} sub={interRate ? interRate.toFixed(1) + "%" : null} />
        </div>
      </div>
      {spark.length >= 2 && (
        <div className="w-24 sm:w-32 h-16 sm:h-20 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
              <Area
                type="monotone"
                dataKey="reach"
                stroke="#EDE5D0"
                strokeWidth={1.5}
                fill="#EDE5D0"
                fillOpacity={0.15}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function StoryMetric({ label, value, sub }) {
  return (
    <div>
      <div className="text-[10px] mono-font text-white/40 uppercase">{label}</div>
      <div className="text-sm text-white">
        {value ?? "—"}
        {sub && <span className="text-white/40 text-[10px] mono-font ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function DateRangeSelector({
  selection,
  isCustom,
  customOpen,
  setCustomOpen,
  onPreset,
  onCustom,
  days,
  sinceUnix,
  untilUnix,
}) {
  const [draftRange, setDraftRange] = useState(() => ({
    from: new Date(sinceUnix * 1000),
    to: new Date(untilUnix * 1000),
  }));

  useEffect(() => {
    if (customOpen) {
      setDraftRange({
        from: new Date(sinceUnix * 1000),
        to: new Date(untilUnix * 1000),
      });
    }
  }, [customOpen, sinceUnix, untilUnix]);

  const applyCustom = () => {
    if (draftRange?.from && draftRange?.to && draftRange.from < draftRange.to) {
      const t = new Date(draftRange.to);
      t.setHours(23, 59, 59, 0);
      onCustom(draftRange.from, t);
      setCustomOpen(false);
    }
  };

  const customLabel = isCustom
    ? `${new Date(sinceUnix * 1000).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
      })} → ${new Date(untilUnix * 1000).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
      })}`
    : "custom";

  const draftDays =
    draftRange?.from && draftRange?.to
      ? Math.max(
          1,
          Math.round(
            (draftRange.to.getTime() - draftRange.from.getTime()) / 86400000
          )
        )
      : 0;

  return (
    <div className="glass rounded-3xl sm:rounded-full px-2 py-1 flex flex-wrap sm:flex-nowrap items-center gap-1 w-full sm:w-auto">
      {[7, 30, 90].map((d) => {
        const active = !isCustom && selection.preset === d;
        return (
          <button
            key={d}
            onClick={() => onPreset(d)}
            className={`px-3 py-1.5 text-xs rounded-full transition mono-font whitespace-nowrap ${
              active
                ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                : "text-white/60 hover:text-white"
            }`}
          >
            {d}d
          </button>
        );
      })}
      <Popover.Root open={customOpen} onOpenChange={setCustomOpen}>
        <Popover.Trigger asChild>
          <button
            className={`px-3 py-1.5 text-xs rounded-full transition mono-font flex items-center gap-1.5 whitespace-nowrap max-w-full ${
              isCustom
                ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Calendar size={11} />
            <span className="truncate">{customLabel}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={10}
            align="end"
            collisionPadding={16}
            className="z-[100] rounded-3xl p-4 sm:p-5 shadow-2xl pulp-calendar w-[min(calc(100vw-2rem),22rem)] sm:w-auto"
            style={{
              background:
                "linear-gradient(180deg, rgba(22,79,63,0.98) 0%, rgba(11,58,48,0.98) 100%)",
              border: "1px solid rgba(237,229,208,0.15)",
              backdropFilter: "blur(24px)",
            }}
          >
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <div className="display-font text-xl text-white italic">
                  scegli un periodo
                </div>
                <div className="text-[10px] mono-font text-white/50 mt-1">
                  clicca due date per definire il range
                </div>
              </div>
              {draftDays > 0 && (
                <div className="text-[11px] mono-font text-[#EDE5D0]">
                  {draftDays} {draftDays === 1 ? "giorno" : "giorni"}
                </div>
              )}
            </div>

            <DayPicker
              mode="range"
              selected={draftRange}
              onSelect={setDraftRange}
              numberOfMonths={1}
              locale={it}
              weekStartsOn={1}
              disabled={{ after: new Date() }}
              showOutsideDays
            />

            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
              <button
                onClick={() => setCustomOpen(false)}
                className="text-white/50 hover:text-white text-xs mono-font transition"
              >
                annulla
              </button>
              <div className="flex-1" />
              <button
                onClick={applyCustom}
                disabled={
                  !(
                    draftRange?.from &&
                    draftRange?.to &&
                    draftRange.from < draftRange.to
                  )
                }
                className="bg-[#EDE5D0] text-[#0B3A30] rounded-full px-4 py-1.5 text-xs font-semibold mono-font hover:bg-white transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                applica
              </button>
            </div>
            <Popover.Arrow className="fill-[#0B3A30]" width={14} height={7} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

// RateCard — tile compatto per la "rate strip" sotto l'hero.
// Pensato per metriche derivate (save rate, share rate, views totali, engaged).
// Meno imponente di KpiCard ma con tier pill visibile quando applicabile.
function RateCard({ icon, label, value, tier, deltaPct, info }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 transition hover:border-white/15">
      <div className="flex items-center gap-2 text-white/55 text-[10px] mono-font mb-2 uppercase tracking-wider">
        {icon}
        <span className="truncate">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className="display-font text-[1.75rem] sm:text-2xl text-white font-light tabular-nums break-words">
        {value}
      </div>
      {(tier || deltaPct != null) && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {deltaPct != null && <DeltaPill value={deltaPct} />}
          {tier && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
              style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
            >
              {tier.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ReachTrio — tre numeri sintetici accanto al titolo del reach chart:
// totale, media giornaliera, picco (con data). Dà densità informativa alla
// parte alta del panel che altrimenti è solo titolo + sottotitolo.
function ReachTrio({ data }) {
  const total = data.reduce((s, d) => s + (d.reach || 0), 0);
  const avg = data.length ? total / data.length : 0;
  const peak = data.reduce(
    (m, d) => (d.reach > m.reach ? d : m),
    { reach: 0, date: "—" }
  );
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 sm:gap-5 text-left sm:text-right">
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          totale
        </div>
        <div className="text-sm mono-font text-white font-semibold tabular-nums">
          {fmt(total)}
        </div>
      </div>
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          media/g
        </div>
        <div className="text-sm mono-font text-white font-semibold tabular-nums">
          {fmt(avg)}
        </div>
      </div>
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          picco · {peak.date}
        </div>
        <div className="text-sm mono-font text-[#EDE5D0] font-semibold tabular-nums">
          {fmt(peak.reach)}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, accent, deltaPct, tier, tierLabel, sparkline, info }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 relative overflow-hidden group transition">
      <div
        className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-2xl group-hover:opacity-40 transition`}
      />
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font mb-3">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
        {info && <InfoTip text={info} side="bottom" />}
      </div>
      <div className="display-font text-3xl sm:text-4xl text-white font-light break-words">{value}</div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {deltaPct != null && <DeltaPill value={deltaPct} />}
        {tier && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
            style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
          >
            {tierLabel ? `${tier.label} · ${tierLabel}` : `tier ${tier.label}`}
          </span>
        )}
      </div>
      {sparkline && sparkline.length >= 2 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkline} height={24} />
        </div>
      )}
    </div>
  );
}

function DeltaPill({ value }) {
  const flat = Math.abs(value) < 2;
  const up = value > 0;
  const color = flat
    ? "text-white/40 bg-white/5"
    : up
    ? "text-[#8FB5A3] bg-[#8FB5A3]/10"
    : "text-[#D98B6F] bg-[#D98B6F]/10";
  const arrow = flat ? "=" : up ? "↑" : "↓";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font ${color}`}
    >
      {arrow} {Math.abs(value).toFixed(1)}%{" "}
      <span className="text-white/30">vs prec.</span>
      <InfoTip
        text="Variazione rispetto al periodo precedente di pari durata. Se stai guardando 7g, confronto coi 7g precedenti; se 30g, coi 30g precedenti."
        side="top"
      />
    </span>
  );
}

function SummaryRow({ icon, label, value, deltaPct, info, tier }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-b-0">
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font">
        {icon}
        <span>{label}</span>
        {info && <InfoTip text={info} side="top" />}
      </div>
      <div className="text-right">
        <div className="text-white text-lg mono-font font-semibold">{value}</div>
        {deltaPct != null && (
          <div className="mt-0.5">
            <DeltaPill value={deltaPct} />
          </div>
        )}
        {tier && (
          <div className="mt-0.5">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
              style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
            >
              {tier.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentMixStat({ label, info, value }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-white/50 uppercase text-[9px] tracking-wider">
        <span>{label}</span>
        <InfoTip text={info} side="top" />
      </div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );
}

function ContentTypeTile({ data }) {
  const bench = benchmarkTier(data.avgBenchmarkRatio);
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: MEDIA_TYPE_COLORS[data.type] }}
          />
          <span className="text-xs mono-font uppercase tracking-wider text-white/70">
            {MEDIA_TYPE_LABELS[data.type]}
          </span>
        </div>
        {bench && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] mono-font uppercase tracking-wider"
            style={{ backgroundColor: `${bench.color}15`, color: bench.color }}
          >
            {bench.label}
          </span>
        )}
      </div>
      <div className="display-font text-3xl text-white font-light mb-1">
        {data.count}
      </div>
      <div className="text-[10px] mono-font text-white/40 uppercase tracking-wider">
        post
      </div>
      {data.count > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-[11px] mono-font">
          <ContentMixStat
            label="Reach medio"
            info={CONTENT_MIX_COPY.avgReach}
            value={fmt(data.avgReach)}
          />
          <ContentMixStat
            label="ER medio"
            info={CONTENT_MIX_COPY.avgEr}
            value={`${data.avgEr.toFixed(1)}%`}
          />
          <ContentMixStat
            label="Reach/giorno"
            info={CONTENT_MIX_COPY.avgVelocity}
            value={fmt(data.avgVelocity)}
          />
          <ContentMixStat
            label="Vs atteso"
            info={CONTENT_MIX_COPY.avgBenchmark}
            value={fmtSignedPct(
              data.avgBenchmarkRatio != null
                ? (data.avgBenchmarkRatio - 1) * 100
                : null
            )}
          />
        </div>
      )}
      {data.outlierCount > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] mono-font">
          <span className="text-white/40 uppercase tracking-wider">
            outlier
          </span>
          <span className="text-[#EDE5D0] font-semibold">
            {data.outlierCount}
          </span>
        </div>
      )}
    </div>
  );
}

function Sparkline({ data, height = 28 }) {
  if (!data || data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EDE5D0" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#EDE5D0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="reach"
          stroke="#EDE5D0"
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function LifecycleMiniChart({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="reachPct"
            stroke="#EDE5D0"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="savedPct"
            stroke="#7FB3A3"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-3 text-[9px] mono-font uppercase tracking-wider text-white/35">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-[2px] rounded-full bg-[#EDE5D0]" />
          reach
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-[2px] rounded-full bg-[#7FB3A3]" />
          saved
        </span>
      </div>
    </div>
  );
}

function PostCard({ post, rank }) {
  const thumb = post.thumbnail_url || post.media_url;
  const caption = (post.caption || "").slice(0, 80);
  const isVideo = isVideoLikeMedia(post);
  const bench = benchmarkTier(post.benchmarkRatio);
  const curveMeta = CURVE_TYPE_META[post.curveType] || CURVE_TYPE_META.forming;
  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className="glass rounded-2xl overflow-hidden block group transition hover:scale-[1.02]"
    >
      <div className="relative aspect-square bg-black/40 overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="w-full h-full object-cover group-hover:scale-110 transition duration-700"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <ImageIcon size={40} />
          </div>
        )}
        <div className="absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs mono-font text-white">
          #{rank}
        </div>
        {post.outlierFlag && (
          <div className="absolute top-12 left-3 rounded-full border border-[#EDE5D0]/40 bg-black/35 px-2 py-0.5 text-[9px] mono-font uppercase tracking-wider text-[#EDE5D0]">
            outlier
          </div>
        )}
        {isVideo && (
          <div className="absolute top-3 right-3 glass rounded-full p-2">
            <Film size={14} className="text-white" />
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent h-20" />
        <div className="absolute bottom-3 left-3 text-[10px] text-white/70 mono-font flex items-center gap-1">
          <Calendar size={10} /> {fmtDate(post.timestamp)}
        </div>
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 items-end">
          {isVideo && post.views > 0 && (
            <span className="text-[10px] mono-font px-2 py-0.5 rounded-full bg-black/40 text-[#EDE5D0]">
              {fmt(post.views)} views
            </span>
          )}
          <span className="text-[10px] mono-font px-2 py-0.5 rounded-full bg-black/40 text-white/80">
            ER {post.er.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {caption && (
          <p className="text-white/70 text-xs mb-3 line-clamp-2 leading-relaxed">
            {caption}
            {post.caption?.length > 80 && "…"}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="rounded-full px-2 py-0.5 text-[10px] mono-font bg-white/5 text-white/75">
            {fmt(post.velocity7d)}/g
          </span>
          {bench && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] mono-font"
              style={{ backgroundColor: `${bench.color}15`, color: bench.color }}
            >
              {fmtSignedPct(post.benchmarkDeltaPct)} vs atteso
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-[10px] mono-font"
            style={{
              backgroundColor: `${curveMeta.color}15`,
              color: curveMeta.color,
            }}
          >
            {curveMeta.label}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-3 border-t border-white/5">
          <Metric
            icon={<TrendingUp size={11} />}
            value={fmt(post.reach)}
            label="reach"
          />
          <Metric
            icon={<Heart size={11} />}
            value={fmt(post.like_count)}
            label="like"
          />
          <Metric
            icon={<Bookmark size={11} />}
            value={fmt(post.saved)}
            label="salvati"
          />
          <Metric
            icon={<Share2 size={11} />}
            value={fmt(post.shares)}
            label="shares"
          />
        </div>
        {post.lifecycleSeries && post.lifecycleSeries.length >= 2 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[9px] text-white/30 mono-font uppercase tracking-wider">
                timeline 7g
              </div>
              <div className="text-[9px] text-white/40 mono-font uppercase tracking-wider">
                {post.observedDays}/7g osservati
              </div>
            </div>
            <LifecycleMiniChart data={post.lifecycleSeries} />
          </div>
        )}
      </div>
    </a>
  );
}

function Metric({ icon, value, label }) {
  return (
    <div>
      <div className="flex items-center justify-center text-white/40 mb-1">
        {icon}
      </div>
      <div className="text-white text-sm mono-font font-semibold">{value}</div>
      <div className="text-[9px] text-white/30 mono-font uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function AudiencePanel({ icon, title, data, colors, labelMap }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font mb-4 uppercase tracking-wider">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-3">
        {sorted.map((row) => {
          const pct = (row.value / total) * 100;
          const color = colors?.[row.key] || "#EDE5D0";
          const label = labelMap?.[row.key] || row.key;
          return (
            <div key={row.key}>
              <div className="flex justify-between text-[11px] mono-font mb-1">
                <span className="text-white/80">{label}</span>
                <span className="text-white/50">
                  {pct.toFixed(1)}% · {fmt(row.value)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="glass rounded-xl px-4 py-3 text-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      <div className="text-white/50 mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-white">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.color || p.fill }}
          />
          <span className="text-white/70">{p.name || p.dataKey}:</span>
          <span className="font-semibold">
            {typeof p.value === "number" && p.value < 100
              ? p.value.toFixed(1)
              : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Tooltip del chart Reach giornaliero: mostra reach del giorno + lista
// dei post pubblicati quel giorno (label tipo + caption breve, colore-coded).
function ReachWithPostsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const reachItem = payload.find((p) => p.dataKey === "reach");
  const reach = reachItem?.value;
  const dayPosts = payload[0]?.payload?._posts || [];
  return (
    <div
      className="glass rounded-xl px-4 py-3 text-xs max-w-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      <div className="text-white/50 mb-1">{label}</div>
      {reach != null && (
        <div className="flex items-center gap-2 text-white mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#EDE5D0" }}
          />
          <span className="text-white/70">reach:</span>
          <span className="font-semibold">{fmt(reach)}</span>
        </div>
      )}
      {dayPosts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
          {dayPosts.map((p) => {
            const t = resolveMediaType(p);
            const key = POST_DOT_COLORS[t] ? t : "IMAGE";
            const caption = (p.caption || "").slice(0, 80);
            return (
              <div key={p.id} className="flex gap-2">
                <div
                  className="w-2 h-2 mt-1 rounded-full shrink-0"
                  style={{ backgroundColor: POST_DOT_COLORS[key] }}
                />
                <div className="text-white/80 leading-snug">
                  <span className="text-white/50">
                    {POST_DOT_LABELS[key]}
                  </span>
                  {caption && (
                    <span className="text-white/70"> · {caption}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="glass rounded-xl p-3 text-xs max-w-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      {d.thumb && (
        <img
          src={d.thumb}
          alt=""
          className="w-full h-32 object-cover rounded-lg mb-2"
          loading="lazy"
        />
      )}
      <div className="text-white/50 text-[10px] mb-1">{fmtDate(d.date)}</div>
      {d.caption && (
        <p className="text-white/80 text-[11px] mb-2 line-clamp-2">
          {d.caption.slice(0, 80)}
          {d.caption.length > 80 ? "…" : ""}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <span className="text-white/50">reach</span>
          <span className="text-white font-semibold ml-1">{fmt(d.x)}</span>
        </div>
        <div>
          <span className="text-white/50">ER</span>
          <span className="text-white font-semibold ml-1">
            {d.y.toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-white/50">reach/g</span>
          <span className="text-white font-semibold ml-1">
            {fmt(d.velocity7d)}/g
          </span>
        </div>
        <div>
          <span className="text-white/50">vs atteso</span>
          <span className="text-white font-semibold ml-1">
            {fmtSignedPct(d.benchmarkDeltaPct)}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-white/50">quadrant</span>
          <span className="text-white font-semibold ml-1">{d.quadrant}</span>
          {d.outlierFlag && (
            <span className="ml-2 text-[#EDE5D0] uppercase">outlier</span>
          )}
        </div>
      </div>
    </div>
  );
}
