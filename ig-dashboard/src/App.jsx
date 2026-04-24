import React, { useState, useEffect, useMemo } from "react";
import {
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  BarChart,
  Bar,
  Cell as BarCell,
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
  Image as ImageIcon,
} from "lucide-react";
import { TOKEN, PAGE_ID, API } from "./config.js";
import { generateFakeData, isFakeToken } from "./fakeData.js";

const FAKE_MODE = isFakeToken(TOKEN);

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

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });

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

// Extract a metric value from the embedded insights array on a post
const metricOf = (post, name) =>
  post.insights?.data?.find((x) => x.name === name)?.values?.[0]?.value ?? 0;

// Interactions sum for a single post (likes + comments + saved + shares)
const postInteractions = (p) =>
  (p.like_count || 0) +
  (p.comments_count || 0) +
  metricOf(p, "saved") +
  metricOf(p, "shares");

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
  const [dateRange, setDateRange] = useState(30);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortMode, setSortMode] = useState("reach");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const warns = [];

      // Demo mode: TOKEN vuoto → dati fake, niente fetch.
      if (FAKE_MODE) {
        const fake = generateFakeData(dateRange);
        setAccount(fake.account);
        setInsights({ totals: fake.totals, reachDaily: fake.reachDaily });
        setInsightsPrev({ totals: fake.totalsPrev });
        setPosts(fake.posts);
        setAudience(fake.audience);
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

        const since = daysAgoTs(dateRange);
        const until = Math.floor(Date.now() / 1000);
        const sincePrev = daysAgoTs(2 * dateRange);
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
          "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";
        const mediaUrl = `${API}/${igUserId}/media?fields=${mediaFields}&limit=30&access_token=${TOKEN}`;
        const mRes = await fetch(mediaUrl);
        const mData = await mRes.json();
        if (mData.error) {
          warns.push(`media insights: ${mData.error.message}`);
          const fallback = await fetch(
            `${API}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=30&access_token=${TOKEN}`
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
  }, [dateRange, refreshKey]);

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

  const enrichedPosts = useMemo(() => {
    return posts.map((p) => {
      const reach = metricOf(p, "reach");
      const saved = metricOf(p, "saved");
      const shares = metricOf(p, "shares");
      const views = metricOf(p, "views");
      const interactions = postInteractions(p);
      const er = reach > 0 ? (interactions / reach) * 100 : 0;
      return { ...p, reach, saved, shares, views, interactions, er };
    });
  }, [posts]);

  const sortedPosts = useMemo(() => {
    const arr = [...enrichedPosts];
    const cmp = {
      reach: (a, b) => b.reach - a.reach,
      er: (a, b) => b.er - a.er,
      saved: (a, b) => b.saved - a.saved,
      shares: (a, b) => b.shares - a.shares,
    }[sortMode];
    arr.sort(cmp);
    return arr;
  }, [enrichedPosts, sortMode]);

  const scatterByType = useMemo(() => {
    const byType = {
      REELS: [],
      VIDEO: [],
      IMAGE: [],
      CAROUSEL_ALBUM: [],
    };
    enrichedPosts.forEach((p) => {
      const type = byType[p.media_type] ? p.media_type : "IMAGE";
      byType[type].push({
        x: p.reach,
        y: p.er,
        z: p.interactions,
        id: p.id,
        caption: p.caption,
        permalink: p.permalink,
        thumb: p.thumbnail_url || p.media_url,
        date: p.timestamp,
      });
    });
    return byType;
  }, [enrichedPosts]);

  const contentMix = useMemo(() => {
    const mix = {};
    Object.keys(MEDIA_TYPE_LABELS).forEach((t) => {
      mix[t] = { count: 0, reachSum: 0, interSum: 0 };
    });
    enrichedPosts.forEach((p) => {
      const bucket = mix[p.media_type] ? p.media_type : "IMAGE";
      mix[bucket].count += 1;
      mix[bucket].reachSum += p.reach;
      mix[bucket].interSum += p.interactions;
    });
    return Object.entries(mix).map(([type, v]) => ({
      type,
      count: v.count,
      avgReach: v.count ? v.reachSum / v.count : 0,
      avgEr: v.reachSum ? (v.interSum / v.reachSum) * 100 : 0,
    }));
  }, [enrichedPosts]);

  const heatmap = useMemo(() => {
    const grid = Array(7)
      .fill(null)
      .map(() =>
        Array(6)
          .fill(null)
          .map(() => ({ count: 0, reachSum: 0 }))
      );
    enrichedPosts.forEach((p) => {
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
    return { grid, maxAvg, total: enrichedPosts.length };
  }, [enrichedPosts]);

  return (
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

      <div className="max-w-7xl mx-auto px-6 py-10 relative grain">
        {/* Header */}
        <header className="flex items-start justify-between mb-10 fadein flex-wrap gap-4">
          <div className="flex items-start gap-5">
            <img
              src="/logo-mark.jpeg"
              alt="The Pulp"
              className="w-14 h-14 rounded-2xl object-cover shrink-0 ring-1 ring-[#EDE5D0]/10"
            />
            <div>
              <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-[0.3em] text-[#EDE5D0]/70 mono-font">
                <Sparkles size={14} /> Instagram Insights
                {FAKE_MODE && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 text-[10px] tracking-normal normal-case">
                    demo · dati fake
                  </span>
                )}
              </div>
              <h1 className="display-font text-5xl md:text-6xl font-light text-white leading-none">
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
                <p className="mt-3 text-white/50 text-sm mono-font">
                  {account.name && <>{account.name} · </>}
                  {fmt(account.media_count)} post totali · IG Business
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="glass px-4 py-2 rounded-full text-xs text-white/80 flex items-center gap-2 hover:text-white transition mono-font"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <div className="glass rounded-full px-2 py-1 flex items-center gap-1">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDateRange(d)}
                  className={`px-3 py-1.5 text-xs rounded-full transition mono-font ${
                    dateRange === d
                      ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
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
          <div className="glass rounded-3xl p-20 text-center">
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
            {/* Hero KPIs */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10 fadein">
              <KpiCard
                icon={<Users size={16} />}
                label="Followers"
                value={fmt(account.followers_count)}
                accent="from-[#EDE5D0] to-[#D4A85C]"
              />
              <KpiCard
                icon={<UserPlus size={16} />}
                label="Seguiti"
                value={fmt(account.follows_count)}
                accent="from-[#D4A85C] to-[#B8823A]"
              />
              <KpiCard
                icon={<TrendingUp size={16} />}
                label={`Reach · ${dateRange}g`}
                value={fmt(totals.reach)}
                deltaPct={delta(totals.reach, totalsPrev.reach)}
                accent="from-[#8FB5A3] to-[#3E7A66]"
              />
              <KpiCard
                icon={<Activity size={16} />}
                label={`Engagement · ${dateRange}g`}
                value={fmtPct(engagementRate)}
                deltaPct={delta(engagementRate, engagementRatePrev)}
                accent="from-[#3E7A66] to-[#0E4A3E]"
              />
            </section>

            {/* Reach chart + secondary panel */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10 fadein">
              {reachChartData.length > 0 && (
                <div className="glass rounded-3xl p-6 md:p-8 lg:col-span-2">
                  <div className="mb-6">
                    <h2 className="display-font text-2xl text-white font-light">
                      Reach giornaliero
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      ultimi {dateRange} giorni
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={reachChartData}>
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
                      <Tooltip content={<DarkTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="reach"
                        stroke="#EDE5D0"
                        strokeWidth={2}
                        fill="url(#reachGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="glass rounded-3xl p-6 md:p-8 flex flex-col gap-4">
                <div>
                  <h2 className="display-font text-2xl text-white font-light">
                    Sintesi
                  </h2>
                  <p className="text-xs text-white/40 mono-font mt-1">
                    metriche aggregate {dateRange}g
                  </p>
                </div>
                <SummaryRow
                  icon={<Sparkles size={14} />}
                  label="Account coinvolti"
                  value={fmt(totals.accounts_engaged)}
                  deltaPct={delta(
                    totals.accounts_engaged,
                    totalsPrev.accounts_engaged
                  )}
                />
                <SummaryRow
                  icon={<Heart size={14} />}
                  label="Interazioni totali"
                  value={fmt(totals.total_interactions)}
                  deltaPct={delta(
                    totals.total_interactions,
                    totalsPrev.total_interactions
                  )}
                />
                <SummaryRow
                  icon={<Eye size={14} />}
                  label="Profile views"
                  value={fmt(totals.profile_views)}
                  deltaPct={delta(totals.profile_views, totalsPrev.profile_views)}
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
                  />
                )}
              </div>
            </section>

            {/* Content mix */}
            {enrichedPosts.length > 0 && (
              <section className="mb-10 fadein">
                <div className="flex items-baseline justify-between mb-6">
                  <div>
                    <h2 className="display-font text-3xl text-white font-light">
                      <span className="italic">content</span> mix
                    </h2>
                    <p className="text-xs text-white/40 mono-font mt-1">
                      come performano i diversi tipi di contenuto
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                  <div className="lg:col-span-2 grid grid-cols-2 gap-3">
                    {contentMix.map((m) => (
                      <ContentTypeTile key={m.type} data={m} />
                    ))}
                  </div>
                  <div className="glass rounded-3xl p-6 lg:col-span-3">
                    <p className="text-xs text-white/40 mono-font mb-4 uppercase tracking-wider">
                      Reach medio per tipo
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
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
                      reach × engagement rate · colore per tipo
                    </p>
                  </div>
                  <div className="glass rounded-full px-2 py-1 flex items-center gap-1">
                    {[
                      { k: "reach", label: "Reach" },
                      { k: "er", label: "Engagement" },
                      { k: "saved", label: "Salvati" },
                      { k: "shares", label: "Shares" },
                    ].map(({ k, label }) => (
                      <button
                        key={k}
                        onClick={() => setSortMode(k)}
                        className={`px-3 py-1.5 text-xs rounded-full transition mono-font ${
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

                <div className="glass rounded-3xl p-6 md:p-8 mb-6">
                  <ResponsiveContainer width="100%" height={320}>
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
                    </ScatterChart>
                  </ResponsiveContainer>
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
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedPosts.slice(0, 12).map((p, i) => (
                    <PostCard key={p.id} post={p} rank={i + 1} />
                  ))}
                </div>
              </section>
            )}

            {/* Best time to post */}
            {enrichedPosts.length > 0 && (
              <section className="glass rounded-3xl p-6 md:p-8 mb-10 fadein">
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

            {/* Audience */}
            {audience && (
              <section className="mb-10 fadein">
                <div className="mb-6">
                  <h2 className="display-font text-3xl text-white font-light">
                    <span className="italic">audience</span>
                  </h2>
                  <p className="text-xs text-white/40 mono-font mt-1">
                    breakdown dei follower · lifetime
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              </section>
            )}

            <footer className="text-center text-white/30 text-xs mono-font pt-8 border-t border-white/5">
              dati live · facebook graph api v21 ·{" "}
              {new Date().toLocaleString("it-IT")}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, accent, deltaPct }) {
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden group transition">
      <div
        className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-2xl group-hover:opacity-40 transition`}
      />
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font mb-3">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="display-font text-4xl text-white font-light">{value}</div>
      {deltaPct != null && (
        <div className="mt-2">
          <DeltaPill value={deltaPct} />
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
    </span>
  );
}

function SummaryRow({ icon, label, value, deltaPct }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-b-0">
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-right">
        <div className="text-white text-lg mono-font font-semibold">{value}</div>
        {deltaPct != null && (
          <div className="mt-0.5">
            <DeltaPill value={deltaPct} />
          </div>
        )}
      </div>
    </div>
  );
}

function ContentTypeTile({ data }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: MEDIA_TYPE_COLORS[data.type] }}
        />
        <span className="text-xs mono-font uppercase tracking-wider text-white/70">
          {MEDIA_TYPE_LABELS[data.type]}
        </span>
      </div>
      <div className="display-font text-3xl text-white font-light mb-1">
        {data.count}
      </div>
      <div className="text-[10px] mono-font text-white/40 uppercase tracking-wider">
        post
      </div>
      {data.count > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-[11px] mono-font">
          <div>
            <div className="text-white/50 uppercase text-[9px] tracking-wider">
              Reach avg
            </div>
            <div className="text-white font-semibold">{fmt(data.avgReach)}</div>
          </div>
          <div>
            <div className="text-white/50 uppercase text-[9px] tracking-wider">
              ER avg
            </div>
            <div className="text-white font-semibold">
              {data.avgEr.toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, rank }) {
  const thumb = post.thumbnail_url || post.media_url;
  const caption = (post.caption || "").slice(0, 80);
  const isVideo = post.media_type === "VIDEO" || post.media_type === "REELS";
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
        {isVideo && (
          <div className="absolute top-3 right-3 glass rounded-full p-2">
            <Film size={14} className="text-white" />
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent h-20" />
        <div className="absolute bottom-3 left-3 text-[10px] text-white/70 mono-font flex items-center gap-1">
          <Calendar size={10} /> {fmtDate(post.timestamp)}
        </div>
        <div className="absolute bottom-3 right-3 text-[10px] mono-font px-2 py-0.5 rounded-full bg-black/40 text-white/80">
          ER {post.er.toFixed(1)}%
        </div>
      </div>
      <div className="p-4">
        {caption && (
          <p className="text-white/70 text-xs mb-3 line-clamp-2 leading-relaxed">
            {caption}
            {post.caption?.length > 80 && "…"}
          </p>
        )}
        <div className="grid grid-cols-4 gap-2 text-center pt-3 border-t border-white/5">
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
    <div className="glass rounded-2xl p-5">
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
      </div>
    </div>
  );
}
