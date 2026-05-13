import React, { useState, useEffect, useMemo, useRef } from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as Tabs from "@radix-ui/react-tabs";
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
  ReferenceLine,
} from "recharts";
import {
  Users,
  Eye,
  TrendingUp,
  Heart,
  RefreshCw,
  AlertCircle,
  Film,
  BarChart3,
  Sparkles,
  Activity,
  Share2,
  Clock,
  Globe2,
  LayoutDashboard,
  Grid3x3,
  UsersRound,
  CircleDot,
  Layers,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { TOKEN, PAGE_ID, API } from "./config.js";
import { generateFakeData, isFakeToken } from "./fakeData.js";
import {
  deriveContentMix,
  derivePostAnalytics,
  deriveReelWatchMeta,
  deriveScatterMeta,
  detectRestart,
  isVideoLikeMedia,
  metricOf,
  postInteractions,
  resolveMediaType,
} from "./analytics.js";
import Chat from "./Chat.jsx";
// Sub-componenti estratti per modularita' — vedi src/components/.
import {
  InfoTip,
  ReachWithPostsTooltip,
  ScatterTooltip,
  ReelWatchTooltip,
} from "./components/tooltips.jsx";
import {
  StoriesStrip,
  StoriesTab,
} from "./components/stories.jsx";
import { DateRangeSelector } from "./components/DateRangeSelector.jsx";
import {
  RateCard,
  ReachTrio,
  KpiCard,
  SummaryRow,
} from "./components/kpi-cards.jsx";
import {
  PostCard,
  AudiencePanel,
} from "./components/posts.jsx";

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

// Helpers di formattazione e classificatori tier estratti in src/utils/.
// (vedi format.js e tiers.js per le definizioni)
import {
  fmt,
  fmtPct,
  fmtDate,
  fmtDuration,
  delta,
} from "./utils/format.js";
import {
  erTier,
  reachRateTier,
  shareRateTier,
  watchTimeTier,
  ER_TIERS_LEGEND,
  WATCH_TIME_TIERS_LEGEND,
  MEDIA_TYPE_LABELS,
  MEDIA_TYPE_COLORS,
  POST_DOT_COLORS,
  POST_DOT_LABELS,
  DAYS_IT,
  HOUR_BUCKETS,
} from "./utils/tiers.js";

const CONTENT_MIX_COPY = {
  section:
    "distribuzione e performance per tipo di contenuto nel periodo",
  avgReach:
    "Media del reach dei post di questo formato. Formula: reach totale diviso numero di post.",
  avgEr:
    "Engagement rate del formato. Formula: interazioni totali diviso reach totale x 100. Interazioni = like + commenti + salvataggi + condivisioni.",
  avgVelocity:
    "Velocita di distribuzione. Per ogni post: reach osservato diviso giorni osservati, fino a 7 giorni. Qui vedi la media del formato, espressa come reach al giorno.",
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

  // Clamp alla ripartenza: se l'account ha un restart rilevato e l'utente
  // chiede un periodo che inizia prima, accorciamo la finestra. I giorni
  // pre-rinascita sono un'altra vita dell'account (audience, target, voice
  // diversi) e contaminano qualunque totale.
  const restartUnix = useMemo(
    () =>
      restart?.restart_iso
        ? Math.floor(new Date(restart.restart_iso).getTime() / 1000)
        : null,
    [restart]
  );

  const { days, sinceUnix, untilUnix, sinceClamped, requestedDays } = useMemo(() => {
    let sUnix, uUnix, requested;
    if (isCustom) {
      sUnix = Math.floor(selection.customFrom.getTime() / 1000);
      uUnix = Math.floor(selection.customTo.getTime() / 1000);
      requested = Math.max(1, Math.round((uUnix - sUnix) / 86400));
    } else {
      uUnix = Math.floor(Date.now() / 1000);
      sUnix = uUnix - selection.preset * 86400;
      requested = selection.preset;
    }
    const clamped = restartUnix && restartUnix > sUnix;
    const finalSince = clamped ? restartUnix : sUnix;
    const effective = Math.max(1, Math.round((uUnix - finalSince) / 86400));
    return {
      days: effective,
      sinceUnix: finalSince,
      untilUnix: uUnix,
      sinceClamped: clamped ? restartUnix : null,
      requestedDays: requested,
    };
  }, [isCustom, selection, restartUnix]);

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
  // Ripartenza account: il post dopo il gap più grande (vedi detectRestart).
  // Quando presente, tutti i range vengono clampati per non includere giorni
  // di silenzio pre-ripartenza che gonfiano i totali.
  const [restart, setRestart] = useState(null);
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
          setRestart(data.restart || null);
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

        // Graph API /insights non accetta finestre > 30g (#100). Sopra soglia
        // calcoliamo totali e reach daily dal daily_snapshot di Turso (caricato
        // via /api/dev/history più sotto) — l'unica fonte che ha lo storico
        // oltre 30g. La conseguenza: i totali sono sum-of-daily (≠ unique
        // mensile reale), già etichettati con "*" via computeTotalsFromDaily.
        const GRAPH_INSIGHTS_MAX_SPAN_S = 30 * 86400;
        const useDbForTotals = span > GRAPH_INSIGHTS_MAX_SPAN_S;

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

        if (useDbForTotals) {
          // Setter provvisori vuoti — vengono sovrascritti dopo che
          // /api/dev/history (più sotto) ci passa daily_snapshot.
          setInsights({ totals: {}, reachDaily: [] });
          setInsightsPrev({ totals: {} });
        } else {
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
        }

        // Media + per-post insights
        const mediaFields =
          "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";
        const mediaUrl = `${API}/${igUserId}/media?fields=${mediaFields}&limit=30&access_token=${TOKEN}`;
        const mRes = await fetch(mediaUrl);
        const mData = await mRes.json();
        let livePosts = [];
        if (mData.error) {
          warns.push(`media insights: ${mData.error.message}`);
          const fallback = await fetch(
            `${API}/${igUserId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=30&access_token=${TOKEN}`
          ).then((r) => r.json());
          livePosts = fallback.data || [];
        } else {
          livePosts = mData.data || [];
        }
        setPosts(livePosts);
        // Restart detection lato browser: stessi 30 post che export-json
        // riceve server-side, stessa logica (detectRestart in analytics.js).
        setRestart(detectRestart(livePosts));

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

        // Stories live: lista attive + insights per ognuna. Le stories vivono
        // 24h, /stories ritorna solo quelle non scadute. In live mode niente
        // history (no DB) — solo l'ultimo snapshot per ognuna.
        try {
          const storyListUrl = `${API}/${igUserId}/stories?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=50&access_token=${TOKEN}`;
          const sj = await fetch(storyListUrl).then((r) => r.json());
          const liveStories = sj.data || [];
          if (liveStories.length === 0) {
            setStories([]);
          } else {
            const enriched = await Promise.all(
              liveStories.map(async (s) => {
                try {
                  const ij = await fetch(
                    `${API}/${s.id}/insights?metric=reach,replies,navigation,shares,total_interactions&access_token=${TOKEN}`
                  ).then((r) => r.json());
                  const m = {
                    reach: 0,
                    replies: 0,
                    navigation: 0,
                    shares: 0,
                    total_interactions: 0,
                  };
                  for (const item of ij.data || []) {
                    if (m[item.name] === undefined) continue;
                    const v =
                      item.total_value?.value ??
                      item.values?.[0]?.value ??
                      0;
                    m[item.name] = Number(v) || 0;
                  }
                  return { ...s, ...m };
                } catch {
                  return { ...s, reach: 0, replies: 0, navigation: 0, shares: 0, total_interactions: 0 };
                }
              })
            );
            setStories(enriched);
          }
          setStoryHistory({}); // sovrascritto subito sotto se /api/dev/history risponde
        } catch {
          setStories([]);
        }

        // Storico Turso via Vite middleware (dev-only). La Graph API non
        // espone followerTrend ne' postHistory, quindi senza questo passo
        // le sparkline KPI restano vuote.
        try {
          const histRes = await fetch("/api/dev/history");
          if (histRes.ok) {
            const hist = await histRes.json();
            if (!hist.error) {
              const daily = Array.isArray(hist.followerTrend) ? hist.followerTrend : [];
              if (daily.length) setFollowerTrend(daily);
              if (hist.postHistory && typeof hist.postHistory === "object") setPostHistory(hist.postHistory);
              if (hist.storyHistory && typeof hist.storyHistory === "object") setStoryHistory(hist.storyHistory);
              // Audience fallback: usa il latest snapshot Turso se la Graph
              // API live non ha popolato la sezione (errore silenzioso, sotto
              // soglia engagement, o range pre-rinascita). L'audience è
              // lifetime: lo snapshot di ieri è valido oggi.
              if (
                hist.audience &&
                typeof hist.audience === "object" &&
                Object.keys(hist.audience).length > 0
              ) {
                setAudience((cur) => {
                  if (!cur || Object.keys(cur).length === 0) return hist.audience;
                  return cur;
                });
              }
              // Sovrascrivi la lista stories con l'archivio Turso (Graph API
              // live ritorna solo le attive < 24h; Turso ha tutto lo storico).
              if (Array.isArray(hist.stories) && hist.stories.length > 0) {
                setStories(hist.stories);
              }
              // Fallback per i range > 30g: la Graph API rifiuta, calcoliamo
              // da daily_snapshot. computeTotalsFromDaily/filterReachDaily
              // accettano lo stesso formato di hist.followerTrend.
              if (useDbForTotals && daily.length) {
                setInsights({
                  totals: computeTotalsFromDaily(daily, since, until),
                  reachDaily: filterReachDaily(daily, since, until),
                });
                setInsightsPrev({
                  totals: computeTotalsFromDaily(daily, sincePrev, untilPrev),
                });
              }
            } else {
              warns.push(`history dev: ${hist.error}`);
            }
          } else if (useDbForTotals) {
            warns.push(
              "Range > 30g: serve TURSO_DATABASE_URL in .env (Graph API limitata a 30g)."
            );
          }
        } catch {
          // /api/dev/history non disponibile (e.g. build statico) — silent
        }

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

  // Datapoint per il secondo scatter (Reel: views × watch). Solo reel del
  // periodo con `video_view_total_time` non-null nel latest snapshot — gli
  // altri non hanno dati di watch (NULL per non-reel + reel pre-aprile 2026).
  const reelWatchPoints = useMemo(() => {
    const out = [];
    for (const p of enrichedPosts) {
      if (p.mediaType !== "REELS") continue;
      const hist = postHistory?.[p.id] || [];
      let lastVtt = null;
      let lastViews = null;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].video_view_total_time != null) {
          lastVtt = hist[i].video_view_total_time;
          lastViews = hist[i].views || 0;
          break;
        }
      }
      if (lastVtt == null || lastViews <= 0) continue;
      out.push({
        id: p.id,
        views: lastViews,
        avgWatchSec: lastVtt / lastViews / 1000,
        totalWatchMs: lastVtt,
        caption: p.caption,
        permalink: p.permalink,
        thumb: p.thumbnail_url || p.media_url,
        date: p.timestamp,
      });
    }
    return out;
  }, [enrichedPosts, postHistory]);

  const reelWatchMeta = useMemo(
    () => deriveReelWatchMeta(reelWatchPoints),
    [reelWatchPoints]
  );

  const reelWatchScatterData = useMemo(
    () =>
      reelWatchPoints.map((p) => ({
        ...p,
        x: p.views,
        y: p.avgWatchSec,
        z: p.totalWatchMs,
        quadrant: reelWatchMeta.byId?.[p.id]?.quadrant || "miss",
        outlierFlag: reelWatchMeta.byId?.[p.id]?.outlierFlag || false,
      })),
    [reelWatchPoints, reelWatchMeta]
  );

  const reelWatchOutliers = useMemo(
    () => reelWatchScatterData.filter((p) => p.outlierFlag),
    [reelWatchScatterData]
  );

  const analyzedPosts = useMemo(() => {
    return enrichedPosts.map((post) => ({
      ...post,
      quadrant: scatterMeta.byId?.[post.id]?.quadrant || "weak",
      outlierFlag: scatterMeta.byId?.[post.id]?.outlierFlag || false,
    }));
  }, [enrichedPosts, scatterMeta]);

  // Watch metrics sui reel pubblicati nel periodo.
  //
  // Modello: tre numeri devono essere coerenti tra loro per non confondere
  // l'utente che li guarda insieme nella stessa rate strip:
  //   - Tempo totale = somma `video_view_total_time` (latest snapshot) dei
  //     reel pubblicati nel periodo
  //   - Views totali = somma `views` (latest snapshot) degli stessi reel
  //   - Watch medio = tempo totale / views totali
  //
  // Tutti "lifetime" sui contenuti del periodo. Quando l'utente cambia il
  // filtro data cambia l'insieme dei reel inclusi, quindi i numeri variano
  // organicamente. Storicamente avevamo provato la versione "delta osservato
  // nel periodo" — sembrava più onesta ma rendeva l'avg derivato (≠ avg IG
  // mostrato per reel) e confondeva il rapporto tempo/views.
  // Vedi ADR 008 + wiki/log entry 2026-05-08.
  const {
    reelAvgWatchSec,
    reelTotalWatchMs,
    reelTotalPlays,
    reelPublishedCount,
  } = useMemo(() => {
      const reelsInPeriod = analyzedPosts.filter((p) => p.mediaType === "REELS");
      let totalWatchMs = 0;
      let totalViews = 0;
      let contributingReels = 0;
      for (const p of reelsInPeriod) {
        const hist = postHistory?.[p.id] || [];
        // Ultimo snapshot non-null per video_view_total_time (i NULL legacy
        // pre-aprile 2026 vengono saltati: undercount onesto sui reel vecchi).
        let lastVtt = null;
        let lastViews = null;
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i].video_view_total_time != null) {
            lastVtt = hist[i].video_view_total_time;
            lastViews = hist[i].views || 0;
            break;
          }
        }
        if (lastVtt == null) continue;
        totalWatchMs += lastVtt;
        totalViews += lastViews;
        contributingReels += 1;
      }
      return {
        reelTotalWatchMs: contributingReels ? totalWatchMs : null,
        reelTotalPlays: contributingReels ? totalViews : null,
        reelAvgWatchSec:
          contributingReels && totalViews > 0
            ? totalWatchMs / totalViews / 1000
            : null,
        reelPublishedCount: reelsInPeriod.length,
      };
    }, [analyzedPosts, postHistory]);

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
          caption: post.caption,
          permalink: post.permalink,
          thumb: post.thumbnail_url || post.media_url,
          date: post.timestamp,
          velocity7d: post.velocity7d,
          quadrant: post.quadrant,
          outlierFlag: post.outlierFlag,
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

  // Nuove metriche aggregate periodo: engagement rate (post-based), save rate,
  // share rate, views totali. Calcolate sui post visibili (feed fetched), quindi
  // "indicative del periodo" ma non garantite allineate con total_interactions
  // di daily_snapshot. Engagement rate qui è (Σ interactions post) / (Σ reach
  // post) × 100 — più stabile della media-delle-medie e più diretto sulle
  // decisioni editoriali (l'account-level di daily_snapshot include anche
  // azioni profilo che non dipendono dal contenuto del periodo).
  const postMetricsAgg = useMemo(() => {
    if (!analyzedPosts.length) return null;
    let reachSum = 0;
    let savedSum = 0;
    let sharesSum = 0;
    let interactionsSum = 0;
    let viewsSum = 0;
    let videoCount = 0;
    for (const p of analyzedPosts) {
      reachSum += p.reach;
      savedSum += p.saved;
      sharesSum += p.shares;
      interactionsSum += p.interactions;
      if (isVideoLikeMedia(p)) {
        viewsSum += p.views;
        videoCount += 1;
      }
    }
    return {
      engagementRate: reachSum > 0 ? (interactionsSum / reachSum) * 100 : null,
      saveRate: reachSum > 0 ? (savedSum / reachSum) * 100 : null,
      shareRate: reachSum > 0 ? (sharesSum / reachSum) * 100 : null,
      viewsTotal: viewsSum,
      videoCount,
    };
  }, [analyzedPosts]);

  // Stesso calcolo dell'engagement rate post-based ma sul periodo precedente
  // (stessa durata, finestra adiacente). Serve per il delta vs prec.
  // Filtriamo `posts` direttamente perché analyzedPosts copre solo il periodo
  // corrente. Niente analytics enrichment (curve/quadrant) — qui ci servono solo
  // reach + interactions, che leggiamo da postAnalyticsById o dal post raw.
  const postMetricsAggPrev = useMemo(() => {
    const rangeSec = untilUnix - sinceUnix;
    if (rangeSec <= 0) return null;
    const prevSinceMs = (sinceUnix - rangeSec) * 1000;
    const prevUntilMs = sinceUnix * 1000;
    let reachSum = 0;
    let interactionsSum = 0;
    let reelViewsSum = 0;
    let n = 0;
    for (const p of posts) {
      const t = new Date(p.timestamp).getTime();
      if (t < prevSinceMs || t >= prevUntilMs) continue;
      const a = postAnalyticsById?.[p.id] || {};
      const r = a.reach ?? metricOf(p, "reach") ?? 0;
      const it = a.interactions ?? postInteractions(p) ?? 0;
      reachSum += r;
      interactionsSum += it;
      // Views REEL-only: coerente con il calcolo `reelTotalPlays` del periodo
      // corrente, così il delta confronta mele con mele (Σ views reel
      // pubblicati nel periodo, latest snapshot).
      if (resolveMediaType(p) === "REELS") {
        reelViewsSum += a.views ?? metricOf(p, "views") ?? 0;
      }
      n += 1;
    }
    if (!n) return null;
    return {
      engagementRate: reachSum > 0 ? (interactionsSum / reachSum) * 100 : null,
      reelViewsTotal: reelViewsSum,
      n,
    };
  }, [posts, postAnalyticsById, sinceUnix, untilUnix]);

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

        {sinceClamped && (
          <div className="mb-6 flex items-center gap-2 px-3 py-2 rounded-full bg-[#D4A85C]/10 border border-[#D4A85C]/20 text-[11px] mono-font text-[#D4A85C] w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D4A85C]" />
            finestra effettiva: dal {fmtDate(new Date(sinceClamped * 1000))}
            {" · "}
            <span className="text-white/60">
              {days}g di {requestedDays}g · l'account ha ripreso il {fmtDate(restart.restart_iso)} dopo {restart.pause_days}g di pausa
            </span>
          </div>
        )}

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
            <section className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-10 fadein">
              <KpiCard
                icon={<Users size={16} />}
                label="Followers"
                value={fmt(account.followers_count)}
                sparkline={(() => {
                  // Filtro per il dateRange attivo: la curva deve seguire il
                  // filtro come il resto della dashboard. Le date in
                  // followerTrend sono YYYY-MM-DD (Europe/Rome).
                  const sinceMs = sinceUnix * 1000;
                  const untilMs = untilUnix * 1000;
                  const base = followerTrend
                    .filter((d) => {
                      const t = new Date(`${d.date}T00:00:00Z`).getTime();
                      return t >= sinceMs && t <= untilMs;
                    })
                    .map((d) => ({
                      reach: d.followers,
                      date: fmtDate(d.date),
                    }));
                  const live = account.followers_count;
                  // Appendi il valore live in coda se il periodo include oggi
                  // e l'ultimo daily è diverso dal numero live (la curva
                  // chiude sul valore mostrato nel KPI).
                  const includesToday = untilMs >= Date.now() - 86400000;
                  if (
                    includesToday &&
                    live != null &&
                    base.length > 0 &&
                    base[base.length - 1].reach !== live
                  ) {
                    return [...base, { reach: live, date: "ora" }];
                  }
                  return base;
                })()}
                accent="from-[#EDE5D0] to-[#D4A85C]"
                info="Follower attuali. La piccola curva sotto mostra come il numero cambia giorno per giorno (serve ≥2 giorni di dati per apparire). La Graph API non dà lo storico: ce lo costruiamo noi."
              />
              <KpiCard
                icon={<Film size={16} />}
                label={`Reels · ${dateRange}g`}
                value={String(analyzedPosts.filter((p) => p.mediaType === "REELS").length)}
                accent="from-[#D4A85C] to-[#B8823A]"
                info={`Numero di reel pubblicati negli ultimi ${dateRange} giorni. Watch time e qualità del gancio sono nella card "Tempo reel" della riga sotto.`}
              />
              <KpiCard
                icon={<Layers size={16} />}
                label={`Carousel · ${dateRange}g`}
                value={String(analyzedPosts.filter((p) => p.mediaType === "CAROUSEL_ALBUM").length)}
                accent="from-[#7FB3A3] to-[#3E7A66]"
                info={`Numero di carousel pubblicati negli ultimi ${dateRange} giorni.`}
              />
              <KpiCard
                icon={<ImageIcon size={16} />}
                label={`Foto · ${dateRange}g`}
                value={String(analyzedPosts.filter((p) => p.mediaType === "IMAGE").length)}
                accent="from-[#EDE5D0] to-[#D4A85C]"
                info={`Numero di foto pubblicate negli ultimi ${dateRange} giorni.`}
              />
            </section>

            {/* Rate strip — ordine narrativo: quanti l'hanno visto (views),
                quanto l'hanno guardato (tempo reel), a quanti utenti unici
                arriva (reach), quanto reagiscono (engagement), quanto lo
                inoltrano (share). Save rate rimosso: su micro-account il
                segnale è troppo zero-inflated per essere actionable. */}
            <section className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8 fadein">
              <RateCard
                icon={<Eye size={14} />}
                label={`Views · ${dateRange}g`}
                value={fmt(reelTotalPlays)}
                deltaPct={
                  reelTotalPlays != null && postMetricsAggPrev?.reelViewsTotal != null
                    ? delta(reelTotalPlays, postMetricsAggPrev.reelViewsTotal)
                    : null
                }
                info={`Somma delle visualizzazioni dei reel pubblicati negli ultimi ${dateRange} giorni (latest snapshot). Coerente con la card "Tempo reel" qui a fianco: tempo / views = watch medio mostrato nel pill. Su micro-account cresce a colpi: un reel virale può raddoppiare il totale del periodo.`}
              />
              <RateCard
                icon={<Clock size={14} />}
                label={`Tempo reel · ${dateRange}g`}
                value={reelTotalWatchMs != null ? fmtDuration(reelTotalWatchMs) : "—"}
                tier={watchTimeTier(reelAvgWatchSec)}
                tierLabel={
                  reelAvgWatchSec != null
                    ? `watch ${reelAvgWatchSec.toFixed(reelAvgWatchSec >= 10 ? 0 : 1)}s`
                    : null
                }
                legend={reelAvgWatchSec != null ? WATCH_TIME_TIERS_LEGEND : null}
                legendCurrent={watchTimeTier(reelAvgWatchSec)?.label}
                info={`Tempo TOTALE di visualizzazione accumulato dai reel pubblicati negli ultimi ${dateRange} giorni (${reelPublishedCount} reel). Il pill mostra il watch medio per visualizzazione = tempo / views, coerente con i due tile a fianco: <4s = il gancio non funziona, 4-8s = avg, 8-15s = good, >15s = il reel viene davvero guardato. Possibile undercount sui reel più vecchi del nostro storico (la metrica nel DB è popolata da fine aprile 2026).`}
              />
              <RateCard
                icon={<TrendingUp size={14} />}
                label="Reach"
                value={fmt(totals.reach)}
                deltaPct={delta(totals.reach, totalsPrev.reach)}
                tier={reachRateTier(reachRate)}
                tierLabel={
                  reachRate != null
                    ? `${reachRate.toFixed(0)}% dei follower`
                    : null
                }
                info={`Account UNICI che hanno visto almeno un contenuto negli ultimi ${dateRange} giorni. Un utente che vede 10 post conta 1 (dedupe automatico Meta). Il pill "X% dei follower" è il reach rate: quanto hai bucato la cerchia. Viral >100%, strong 30-100%, normal 10-30%, low <10%.`}
              />
              <RateCard
                icon={<Activity size={14} />}
                label="Engagement"
                value={fmtPct(postMetricsAgg?.engagementRate)}
                deltaPct={
                  postMetricsAgg?.engagementRate != null && postMetricsAggPrev?.engagementRate != null
                    ? delta(postMetricsAgg.engagementRate, postMetricsAggPrev.engagementRate)
                    : null
                }
                tier={erTier(postMetricsAgg?.engagementRate)}
                legend={ER_TIERS_LEGEND}
                legendCurrent={erTier(postMetricsAgg?.engagementRate)?.label}
                info="Engagement rate del periodo, calcolato sui contenuti pubblicati: somma di (like + commenti + salvati + condivisioni) di tutti i post ÷ somma reach dei post × 100. Più stabile della media-delle-medie: un post con reach piccolissimo non gonfia il numero. Diverso dall'ER account-level (basato sui daily_snapshot) — questo riflette esattamente quanto i contenuti del periodo hanno attivato chi li ha visti."
              />
              <RateCard
                icon={<Share2 size={14} />}
                label="Share rate"
                value={fmtPct(postMetricsAgg?.shareRate)}
                tier={shareRateTier(postMetricsAgg?.shareRate)}
                info="Shares ÷ Reach × 100. 'Vale la pena mandarlo a qualcuno'. >1.5% excellent · 0.5–1.5% good · <0.5% avg."
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
                  </div>
                </div>
                {/* 4 tile per tipo (Reels, Carousel, Foto, Video) — sempre tutti
                    visibili anche con count=0, per segnalare assenze esplicite. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { type: "REELS", icon: <Film size={18} className="text-white/60" /> },
                    { type: "CAROUSEL_ALBUM", icon: <Layers size={18} className="text-white/60" /> },
                    { type: "IMAGE", icon: <ImageIcon size={18} className="text-white/60" /> },
                    { type: "VIDEO", icon: <Video size={18} className="text-white/60" /> },
                  ].map(({ type, icon }) => {
                    const m = contentMix.find((x) => x.type === type) || { type, count: 0, avgReach: 0, avgEr: 0 };
                    const empty = m.count === 0;
                    return (
                      <div
                        key={type}
                        className="glass rounded-2xl p-4"
                        style={{ opacity: empty ? 0.45 : 1 }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          {icon}
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: MEDIA_TYPE_COLORS[type] }}
                          />
                          <span className="text-[10px] mono-font uppercase tracking-wider text-white/60 truncate">
                            {MEDIA_TYPE_LABELS[type]}
                          </span>
                        </div>
                        <div className="display-font text-4xl text-white font-light leading-none mb-1">
                          {m.count}
                        </div>
                        <div className="text-[10px] mono-font text-white/40 uppercase tracking-wider mb-3">
                          post
                        </div>
                        {!empty && (
                          <div className="pt-3 border-t border-white/5 space-y-1.5 text-[10px] mono-font">
                            <div className="flex justify-between">
                              <span className="text-white/45">reach medio</span>
                              <span className="text-white font-semibold tabular-nums">{fmt(m.avgReach)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-white/45">ER medio</span>
                              <span className="text-white font-semibold tabular-nums">{m.avgEr.toFixed(1)}%</span>
                            </div>
                            {type === "REELS" && reelAvgWatchSec != null && (
                              <div className="flex justify-between">
                                <span className="text-white/45">watch medio</span>
                                <span className="text-white font-semibold tabular-nums">
                                  {reelAvgWatchSec.toFixed(reelAvgWatchSec >= 10 ? 0 : 1)}s
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        {empty && (
                          <div className="text-[10px] mono-font text-white/30">
                            nessun post nel periodo
                          </div>
                        )}
                      </div>
                    );
                  })}
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
              </section>
            )}

            {/* Reel quality: views × watch medio. Solo reel del periodo con
                video_view_total_time non-null. Stessa idea dello scatter
                primario ma su due metriche di formato: "arriva a tanti?"
                (asse X views) e "lo guardano davvero?" (asse Y watch). */}
            {reelWatchPoints.length >= 2 && (
              <section className="mb-10 fadein">
                <div className="flex items-baseline justify-between flex-wrap gap-3 mb-6">
                  <div>
                    <h2 className="display-font text-3xl text-white font-light">
                      <span className="italic">reel</span> quality
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      views × watch medio · {reelWatchPoints.length} reel · quadranti mediani
                    </p>
                  </div>
                </div>

                <div className="glass rounded-3xl p-5 sm:p-6 md:p-8">
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
                            name="Views"
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                            tickFormatter={fmt}
                          />
                          <YAxis
                            type="number"
                            dataKey="y"
                            name="Watch medio"
                            stroke="rgba(255,255,255,0.3)"
                            tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                            tickFormatter={(v) => `${v.toFixed(v >= 10 ? 0 : 1)}s`}
                          />
                          <ZAxis type="number" dataKey="z" range={[40, 220]} />
                          <ReferenceLine
                            x={reelWatchMeta.viewsMedian}
                            stroke="rgba(237,229,208,0.25)"
                            strokeDasharray="4 4"
                          />
                          <ReferenceLine
                            y={reelWatchMeta.watchMedian}
                            stroke="rgba(127,179,163,0.25)"
                            strokeDasharray="4 4"
                          />
                          <Tooltip
                            content={<ReelWatchTooltip />}
                            cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }}
                          />
                          <Scatter
                            name="Reel"
                            data={reelWatchScatterData}
                            fill="#D4A85C"
                            fillOpacity={0.75}
                            stroke="#D4A85C"
                            strokeWidth={1}
                          />
                          {reelWatchOutliers.length > 0 && (
                            <Scatter
                              name="Outlier"
                              data={reelWatchOutliers}
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
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#D4A85C" }} />
                      Reel
                    </div>
                    {reelWatchOutliers.length > 0 && (
                      <div className="flex items-center gap-2 text-[#EDE5D0]">
                        <span className="w-2.5 h-2.5 rounded-full border border-[#EDE5D0]" />
                        outlier
                      </div>
                    )}
                    <div className="text-white/40 ml-auto">
                      mediana views {fmt(reelWatchMeta.viewsMedian)} · mediana watch {reelWatchMeta.watchMedian.toFixed(reelWatchMeta.watchMedian >= 10 ? 0 : 1)}s
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {reelWatchMeta.quadrants.map((quadrant) => (
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

            {/* Carousel post in fondo: dopo aver letto i due scatter + la
                heatmap, l'utente va sul contenuto specifico. Ordinamento
                pilotato dalle tab `sortMode` ancora più in alto. */}
            {enrichedPosts.length > 0 && (
              <section className="mb-10 fadein">
                <h2 className="display-font text-3xl text-white font-light mb-2">
                  <span className="italic">top</span> post
                </h2>
                <p className="text-xs text-white/40 mono-font mb-6">
                  ordinati per {sortMode} · primi 12 del periodo
                </p>
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
              </Tabs.Content>

              <Tabs.Content value="stories" className="focus:outline-none data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-300">
                <StoriesTab
                  stories={stories}
                  storyHistory={storyHistory}
                  followersCount={account?.followers_count}
                />
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
// La maggior parte dei sub-componenti vive in src/components/ (estratti per
// ridurre la dimensione di App.jsx). Qui resta solo TabTrigger perche' e'
// strettamente legato alla struttura Tabs.List qui sopra.

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

