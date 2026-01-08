import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { hapticFeedback } from '@telegram-apps/sdk-react';
import { Snackbar } from '@telegram-apps/telegram-ui';

import { GroupMenuDrawer } from '@/features/dashboard/GroupMenuDrawer';
import { Skeleton } from '@/components/UI/Skeleton';
import { fetchGroupAnalytics, fetchGroupDetails } from '@/features/dashboard/api';
import type {
  AnalyticsGranularity,
  AnalyticsMessageType,
  AnalyticsPoint,
  GroupAnalyticsSnapshot,
  ManagedGroup,
  Trend,
} from '@/features/dashboard/types';
import { formatNumber } from '@/utils/format';

import styles from './GroupAnalyticsPage.module.css';

// ═══════════════════════════════════════════════════════════════════════════
// 🔥 FIREWALL ANALYTICS - Premium Group Analytics Dashboard
// ═══════════════════════════════════════════════════════════════════════════

type LocationState = { group?: ManagedGroup };
type RangePreset = 'today' | '7d' | '30d' | '90d';
type DateRange = { from: Date; to: Date };

const DAY_MS = 86_400_000;
const CHART_HEIGHT = 200;

const RANGE_OPTIONS: Array<{ key: RangePreset; label: string; days: number; premium?: boolean }> = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days ⭐', days: 90, premium: true },
];

const MESSAGE_TYPES: AnalyticsMessageType[] = ['text', 'photo', 'video', 'voice', 'sticker', 'file', 'link', 'forward'];

const MESSAGE_COLORS: Record<AnalyticsMessageType, string> = {
  text: '#ff6432',
  photo: '#10b981',
  video: '#8b5cf6',
  voice: '#f59e0b',
  gif: '#ec4899',
  sticker: '#06b6d4',
  file: '#6366f1',
  link: '#ef4444',
  forward: '#14b8a6',
};

const MESSAGE_LABELS: Record<AnalyticsMessageType, string> = {
  text: 'Text',
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice',
  gif: 'GIF',
  sticker: 'Sticker',
  file: 'File',
  link: 'Link',
  forward: 'Forward',
};

// ─── Utility Functions ───────────────────────────────────────────────────────

function getRange(preset: RangePreset): DateRange {
  const now = new Date();
  const option = RANGE_OPTIONS.find((o) => o.key === preset);
  const days = option?.days ?? 7;
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now.getTime() - (days - 1) * DAY_MS);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function formatTrend(trend: Trend): string {
  if (trend.direction === 'flat' || !trend.percent) return '0%';
  const arrow = trend.direction === 'up' ? '↑' : '↓';
  return `${arrow} ${trend.percent.toFixed(1)}%`;
}

function getTrendClass(trend: Trend): string {
  if (trend.direction === 'up') return styles.trendUp ?? '';
  if (trend.direction === 'down') return styles.trendDown ?? '';
  return styles.trendFlat ?? '';
}

function aggregateByDay(points: AnalyticsPoint[], range: DateRange): AnalyticsPoint[] {
  const buckets = new Map<string, number>();
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();

  points.forEach((p) => {
    const ts = new Date(p.timestamp).getTime();
    if (ts < fromMs || ts > toMs) return;
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString();
    buckets.set(key, (buckets.get(key) ?? 0) + p.value);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([timestamp, value]) => ({ timestamp, value }));
}

function formatDateLabel(iso: string, granularity: AnalyticsGranularity): string {
  const date = new Date(iso);
  if (granularity === 'hour') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Chart Component ─────────────────────────────────────────────────────────

type ChartPoint = { x: number; y: number; value: number; label: string };

function AreaChart({
  points,
  color,
  width,
  height,
  onHover,
  onLeave,
}: {
  points: AnalyticsPoint[];
  color: string;
  width: number;
  height: number;
  onHover?: (point: ChartPoint, x: number, y: number) => void;
  onLeave?: () => void;
}) {
  const chartPoints = useMemo<ChartPoint[]>(() => {
    if (points.length === 0) return [];
    const max = Math.max(...points.map((p) => p.value), 1);
    const step = points.length > 1 ? width / (points.length - 1) : 0;
    return points.map((p, i) => ({
      x: points.length === 1 ? width / 2 : step * i,
      y: height - (p.value / max) * (height - 20) - 10,
      value: p.value,
      label: formatDateLabel(p.timestamp, 'day'),
    }));
  }, [points, width, height]);

  const linePath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    return chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }, [chartPoints]);

  const areaPath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    const first = chartPoints[0];
    const last = chartPoints[chartPoints.length - 1];
    return `${linePath} L ${last?.x ?? 0} ${height} L ${first?.x ?? 0} ${height} Z`;
  }, [linePath, chartPoints, height]);

  const handleMouseMove = useCallback(
    (e: MouseEvent<SVGRectElement>) => {
      if (!onHover || chartPoints.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const first = chartPoints[0];
      if (!first) return;
      let closest = first;
      let minDist = Math.abs(mouseX - closest.x);
      chartPoints.forEach((p) => {
        const dist = Math.abs(mouseX - p.x);
        if (dist < minDist) {
          minDist = dist;
          closest = p;
        }
      });
      onHover(closest, closest.x, closest.y);
    },
    [chartPoints, onHover]
  );

  const gradientId = `gradient-${color.replace('#', '')}`;

  if (points.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>📊</span>
        <span className={styles.emptyText}>No data for this period</span>
      </div>
    );
  }

  return (
    <svg width={width} height={height} className={styles.chartSvg}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x={0} y={0} width={width} height={height} fill="transparent" onMouseMove={handleMouseMove} onMouseLeave={onLeave} />
    </svg>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export function GroupAnalyticsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [analytics, setAnalytics] = useState<GroupAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snackbar, setSnackbar] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const [rangePreset, setRangePreset] = useState<RangePreset>('7d');
  const [granularity, setGranularity] = useState<AnalyticsGranularity>('day');
  const [visibleTypes, setVisibleTypes] = useState<Set<AnalyticsMessageType>>(new Set(MESSAGE_TYPES));

  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; label: string; value: number } | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(300);

  // Resize observer for chart width
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const update = () => setChartWidth(container.clientWidth || 300);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Load group details
  useEffect(() => {
    if (!groupId || state.group) return;
    fetchGroupDetails(groupId)
      .then((detail) => setGroup(detail.group))
      .catch((err) => console.error('[analytics] Failed to load group:', err));
  }, [groupId, state.group]);

  // Load analytics data
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchGroupAnalytics(groupId);
        if (!cancelled) {
          setAnalytics(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setSnackbar('Failed to load analytics');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [groupId]);

  const range = useMemo(() => getRange(rangePreset), [rangePreset]);
  const isPremium = group?.subscriptionType === 'premium';

  // Aggregate members data
  const membersData = useMemo(() => {
    if (!analytics) return [];
    return aggregateByDay(analytics.members, range);
  }, [analytics, range]);

  const membersTotal = useMemo(() => membersData.reduce((sum, p) => sum + p.value, 0), [membersData]);

  // Aggregate messages data by type
  const messagesData = useMemo(() => {
    if (!analytics) return new Map<AnalyticsMessageType, AnalyticsPoint[]>();
    const result = new Map<AnalyticsMessageType, AnalyticsPoint[]>();
    MESSAGE_TYPES.forEach((type) => {
      const series = analytics.messages.find((s) => s.type === type);
      if (series) {
        result.set(type, aggregateByDay(series.points, range));
      }
    });
    return result;
  }, [analytics, range]);

  const messagesTotal = useMemo(() => {
    let total = 0;
    messagesData.forEach((points) => {
      points.forEach((p) => { total += p.value; });
    });
    return total;
  }, [messagesData]);

  const avgMessagesPerDay = useMemo(() => {
    const days = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / DAY_MS));
    return Math.round(messagesTotal / days);
  }, [messagesTotal, range]);

  // Handlers
  const handleBack = useCallback(() => {
    hapticFeedback.impactOccurred('light');
    navigate(-1);
  }, [navigate]);

  const handleRangeChange = useCallback((preset: RangePreset) => {
    hapticFeedback.selectionChanged();
    setRangePreset(preset);
  }, []);

  const handleGranularityChange = useCallback((g: AnalyticsGranularity) => {
    hapticFeedback.selectionChanged();
    setGranularity(g);
  }, []);

  const handleLegendToggle = useCallback((type: AnalyticsMessageType) => {
    hapticFeedback.selectionChanged();
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleRetry = useCallback(() => {
    if (!groupId) return;
    setError(null);
    setLoading(true);
    fetchGroupAnalytics(groupId)
      .then((data) => { setAnalytics(data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
  }, [groupId]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!groupId) {
    return (
      <div className={styles.errorState}>
        <span className={styles.errorIcon}>🚫</span>
        <h2 className={styles.errorTitle}>Group Not Found</h2>
        <p className={styles.errorText}>Invalid group identifier</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <span className={styles.errorIcon}>⚠️</span>
        <h2 className={styles.errorTitle}>Failed to Load Analytics</h2>
        <p className={styles.errorText}>{error.message}</p>
        <button className={styles.retryButton} onClick={handleRetry}>Try Again</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button className={styles.backButton} onClick={handleBack}>←</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.headerTitle}>{group?.title ?? 'Analytics'}</h1>
          <p className={styles.headerSubtitle}>Group Statistics</p>
        </div>
        <button className={styles.menuButton} onClick={() => setMenuOpen(true)}>
          <span /><span /><span />
        </button>
      </header>

      {/* Stats Hero */}
      <section className={styles.statsHero}>
        {loading ? (
          <>
            <Skeleton height="100px" />
            <Skeleton height="100px" />
            <Skeleton height="100px" />
            <Skeleton height="100px" />
          </>
        ) : (
          <>
            <div className={styles.statCard}>
              <span className={styles.statIcon}>👥</span>
              <span className={styles.statValue}>{formatNumber(membersTotal)}</span>
              <span className={styles.statLabel}>New Members</span>
              {analytics?.summary.membersTrend && (
                <span className={`${styles.statTrend} ${getTrendClass(analytics.summary.membersTrend)}`}>
                  {formatTrend(analytics.summary.membersTrend)}
                </span>
              )}
            </div>

            <div className={styles.statCard}>
              <span className={styles.statIcon}>💬</span>
              <span className={styles.statValue}>{formatNumber(messagesTotal)}</span>
              <span className={styles.statLabel}>Messages</span>
              {analytics?.summary.messagesTrend && (
                <span className={`${styles.statTrend} ${getTrendClass(analytics.summary.messagesTrend)}`}>
                  {formatTrend(analytics.summary.messagesTrend)}
                </span>
              )}
            </div>

            <div className={styles.statCard}>
              <span className={styles.statIcon}>📈</span>
              <span className={styles.statValue}>{formatNumber(avgMessagesPerDay)}</span>
              <span className={styles.statLabel}>Avg/Day</span>
            </div>

            <div className={styles.statCard}>
              <span className={styles.statIcon}>🏆</span>
              <span className={styles.statValue}>
                {analytics?.summary.topMessageType ? MESSAGE_LABELS[analytics.summary.topMessageType] : '-'}
              </span>
              <span className={styles.statLabel}>Top Type</span>
            </div>
          </>
        )}
      </section>

      {/* Filters */}
      <section className={styles.filterSection}>
        <div className={styles.filterRow}>
          {RANGE_OPTIONS.map((opt) => {
            const locked = opt.premium && !isPremium;
            return (
              <button
                key={opt.key}
                className={`${styles.filterChip} ${rangePreset === opt.key ? styles.filterChipActive : ''} ${locked ? styles.filterChipDisabled : ''}`}
                onClick={() => !locked && handleRangeChange(opt.key)}
                disabled={locked}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className={styles.filterRow}>
          <div className={styles.granularityToggle}>
            <button
              className={`${styles.granularityBtn} ${granularity === 'day' ? styles.granularityBtnActive : ''}`}
              onClick={() => handleGranularityChange('day')}
            >
              Daily
            </button>
            <button
              className={`${styles.granularityBtn} ${granularity === 'week' ? styles.granularityBtnActive : ''}`}
              onClick={() => handleGranularityChange('week')}
            >
              Weekly
            </button>
          </div>
        </div>
      </section>

      {/* Charts */}
      <section className={styles.chartSection}>
        {/* Members Chart */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h3 className={styles.chartTitle}>New Members</h3>
              <p className={styles.chartSubtitle}>Growth over selected period</p>
            </div>
          </div>
          <div className={styles.chartContainer} ref={chartContainerRef}>
            {loading ? (
              <Skeleton height="200px" />
            ) : (
              <AreaChart
                points={membersData}
                color="#ff6432"
                width={chartWidth}
                height={CHART_HEIGHT}
                onHover={(p, x, y) => setTooltip({ visible: true, x, y, label: p.label, value: p.value })}
                onLeave={() => setTooltip(null)}
              />
            )}
            {tooltip?.visible && (
              <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
                <div className={styles.tooltipDate}>{tooltip.label}</div>
                <div className={styles.tooltipValue}>{formatNumber(tooltip.value)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Messages Chart */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h3 className={styles.chartTitle}>Message Activity</h3>
              <p className={styles.chartSubtitle}>Messages by type</p>
            </div>
          </div>
          <div className={styles.chartContainer}>
            {loading ? (
              <Skeleton height="200px" />
            ) : messagesTotal === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>📊</span>
                <span className={styles.emptyText}>No messages in this period</span>
              </div>
            ) : (
              <svg width={chartWidth} height={CHART_HEIGHT} className={styles.chartSvg}>
                {MESSAGE_TYPES.filter((t) => visibleTypes.has(t)).map((type) => {
                  const pts = messagesData.get(type) ?? [];
                  if (pts.length === 0) return null;
                  const max = Math.max(...Array.from(messagesData.values()).flatMap((p) => p.map((x) => x.value)), 1);
                  const step = pts.length > 1 ? chartWidth / (pts.length - 1) : 0;
                  const path = pts
                    .map((p, i) => {
                      const x = pts.length === 1 ? chartWidth / 2 : step * i;
                      const y = CHART_HEIGHT - (p.value / max) * (CHART_HEIGHT - 20) - 10;
                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                    })
                    .join(' ');
                  return (
                    <path
                      key={type}
                      d={path}
                      fill="none"
                      stroke={MESSAGE_COLORS[type]}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.8}
                    />
                  );
                })}
              </svg>
            )}
          </div>

          {/* Legend */}
          <div className={styles.legend}>
            {MESSAGE_TYPES.map((type) => (
              <button
                key={type}
                className={`${styles.legendItem} ${visibleTypes.has(type) ? styles.legendItemActive : ''}`}
                onClick={() => handleLegendToggle(type)}
              >
                <span className={styles.legendDot} style={{ background: MESSAGE_COLORS[type] }} />
                {MESSAGE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Menu Drawer */}
      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="analytics"
        onSelect={(key) => {
          if (!groupId) return;
          switch (key) {
            case 'home':
              navigate(`/groups/${groupId}`, { state: { group } });
              break;
            case 'settings':
              navigate(`/groups/${groupId}/settings/general`, { state: { group } });
              break;
            case 'bans':
              navigate(`/groups/${groupId}/settings/bans`, { state: { group } });
              break;
            case 'limits':
              navigate(`/groups/${groupId}/settings/limits`, { state: { group } });
              break;
            case 'mute':
              navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
              break;
            case 'mandatory':
              navigate(`/groups/${groupId}/settings/mandatory`, { state: { group } });
              break;
            case 'texts':
              navigate(`/groups/${groupId}/settings/texts`, { state: { group } });
              break;
            case 'analytics':
              // Already here
              break;
          }
        }}
      />

      {/* Snackbar */}
      {snackbar && (
        <Snackbar onClose={() => setSnackbar('')} className={styles.snackbar}>
          {snackbar}
        </Snackbar>
      )}
    </div>
  );
}
