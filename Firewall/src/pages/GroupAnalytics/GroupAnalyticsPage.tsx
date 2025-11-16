import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  IconButton,
  Placeholder,
  Snackbar,
  Text,
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import { fetchGroupAnalytics, fetchGroupDetails } from "@/features/dashboard/api.ts";
import type {
  AnalyticsGranularity,
  AnalyticsMessageType,
  AnalyticsPoint,
  GroupAnalyticsSnapshot,
  ManagedGroup,
  Trend,
} from "@/features/dashboard/types.ts";
import { formatNumber as formatPersianNumber, toPersianDigits } from "@/utils/format.ts";

import styles from "./GroupAnalyticsPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

type RangePreset = "today" | "7d" | "30d" | "90d" | "custom";

type ChartMode = "line" | "bar";

type DateRange = {
  from: Date;
  to: Date;
};

type CustomRange = {
  from: string;
  to: string;
};

type MembersBucket = {
  timestamp: string;
  label: string;
  value: number;
};

type MessagesBucket = {
  timestamp: string;
  label: string;
  values: Record<AnalyticsMessageType, number>;
};

type MessagesChartSeries = {
  type: AnalyticsMessageType;
  color: string;
};

type TooltipEntry = {
  label: string;
  value: string;
  color?: string;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  pointY: number;
  label: string;
  entries: TooltipEntry[];
  bucketIndex: number;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEK_START_DAY = 6;
const CHART_HEIGHT = 260;
const LOCALE = "en-US";

const RANGE_OPTIONS: Array<{ key: RangePreset; label: string; days?: number }> = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: `${toPersianDigits(7)} days`, days: 7 },
  { key: "30d", label: `${toPersianDigits(30)} days`, days: 30 },
  { key: "90d", label: `${toPersianDigits(90)} days`, days: 90 },
  { key: "custom", label: "Custom" },
];

const MESSAGE_TYPE_LABELS: Record<AnalyticsMessageType, string> = {
  text: "Text",
  photo: "Photo",
  video: "Video",
  voice: "Voice",
  gif: "GIF",
  sticker: "Sticker",
  file: "File",
  link: "Link",
  forward: "Forward",
};

const MESSAGE_TYPE_COLORS: Record<AnalyticsMessageType, string> = {
  text: "var(--tg-theme-accent-text-color, #2563eb)",
  photo: "var(--tg-theme-button-color, #10b981)",
  video: "var(--tg-theme-destructive-text-color, #f97316)",
  voice: "var(--tg-theme-link-color, #8b5cf6)",
  gif: "var(--tg-theme-section-header-text-color, #ec4899)",
  sticker: "var(--tg-theme-subtitle-text-color, #0ea5e9)",
  file: "var(--tg-theme-secondary-bg-color, #facc15)",
  link: "var(--tg-theme-secondary-text-color, #ef4444)",
  forward: "var(--tg-theme-hint-color, #14b8a6)",
};

const MESSAGE_ORDER: AnalyticsMessageType[] = [
  "text",
  "photo",
  "video",
  "voice",
  "gif",
  "sticker",
  "file",
  "link",
  "forward",
];

const GRANULARITY_ORDER: AnalyticsGranularity[] = ["hour", "day", "week", "month"];

const GRANULARITY_LABELS: Record<AnalyticsGranularity, string> = {
  hour: "hours",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

function createEmptyTooltip(): TooltipState {
  return {
    visible: false,
    x: 0,
    y: 0,
    pointY: 0,
    label: "",
    entries: [],
    bucketIndex: -1,
  };
}

function createDateFromInput(value: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function getRange(preset: RangePreset, custom: CustomRange): DateRange {
  const now = new Date();
  if (preset === "custom") {
    const fromDate = createDateFromInput(custom.from);
    const toDate = createDateFromInput(custom.to);
    if (fromDate && toDate && toDate >= fromDate) {
      return { from: startOfDay(fromDate), to: endOfDay(toDate) };
    }
  }
  const option = RANGE_OPTIONS.find((item) => item.key === preset);
  const days = option?.days ?? 7;
  const to = endOfDay(now);
  const from = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return { from, to };
}

function getAllowedGranularities(range: DateRange): AnalyticsGranularity[] {
  const hours = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / HOUR_MS));
  const result: AnalyticsGranularity[] = [];
  if (hours <= 72) {
    result.push("hour");
  }
  result.push("day");
  if (hours > 24 * 14) {
    result.push("week");
  }
  if (hours > 24 * 45) {
    result.push("month");
  }
  return result;
}

function formatDecimal(value: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

function formatPercent(trend: Trend): string {
  if (!trend.percent || trend.direction === "flat") {
    return "0%";
  }
  const arrow = trend.direction === "up" ? "▲" : "▼";
  return `${arrow}${formatDecimal(trend.percent)}%`;
}

function calculateTrend(current: number, previous: number): Trend {
  if (previous <= 0) {
    if (current <= 0) {
      return { direction: "flat", percent: 0 };
    }
    return { direction: "up", percent: 100 };
  }
  const diff = current - previous;
  if (diff === 0) {
    return { direction: "flat", percent: 0 };
  }
  const percent = Math.round(Math.abs((diff / previous) * 1000)) / 10;
  return { direction: diff > 0 ? "up" : "down", percent };
}

function bucketStart(date: Date, granularity: AnalyticsGranularity): Date {
  const bucket = new Date(date);
  if (granularity === "hour") {
    bucket.setMinutes(0, 0, 0);
  } else if (granularity === "day") {
    bucket.setHours(0, 0, 0, 0);
  } else if (granularity === "week") {
    bucket.setHours(0, 0, 0, 0);
    const diff = (bucket.getDay() - WEEK_START_DAY + 7) % 7;
    bucket.setDate(bucket.getDate() - diff);
  } else {
    bucket.setHours(0, 0, 0, 0);
    bucket.setDate(1);
  }
  return bucket;
}

function aggregatePoints(
  points: AnalyticsPoint[],
  range: DateRange,
  granularity: AnalyticsGranularity,
): AnalyticsPoint[] {
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  const buckets = new Map<string, { time: number; value: number }>();
  points.forEach((point) => {
    const timestamp = new Date(point.timestamp).getTime();
    if (Number.isNaN(timestamp) || timestamp < fromMs || timestamp > toMs) {
      return;
    }
    const bucketDate = bucketStart(new Date(timestamp), granularity);
    const key = bucketDate.toISOString();
    const existing = buckets.get(key);
    if (existing) {
      existing.value += point.value;
    } else {
      buckets.set(key, { time: bucketDate.getTime(), value: point.value });
    }
  });

  const aggregated = Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .map((item) => ({ timestamp: new Date(item.time).toISOString(), value: item.value }));

  const maxPoints = granularity === "hour" ? 200 : granularity === "day" ? 120 : 60;
  if (aggregated.length > maxPoints) {
    const step = Math.ceil(aggregated.length / maxPoints);
    return aggregated.filter((_, index) => index % step === 0);
  }

  return aggregated;
}

function sumPoints(points: AnalyticsPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

function bucketLabel(date: Date, granularity: AnalyticsGranularity, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = { timeZone: timezone };
  if (granularity === "hour") {
    options.year = "numeric";
    options.month = "short";
    options.day = "numeric";
    options.hour = "2-digit";
  } else if (granularity === "day") {
    options.year = "numeric";
    options.month = "short";
    options.day = "numeric";
  } else if (granularity === "week") {
    options.year = "numeric";
    options.month = "short";
    options.day = "numeric";
  } else {
    options.year = "numeric";
    options.month = "long";
  }
  return new Intl.DateTimeFormat(LOCALE, options).format(date);
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) {
    return;
  }
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: string | number) => {
    const cell = String(value ?? "");
    if (cell.includes(",") || cell.includes("\"") || cell.includes("\n")) {
      return '"' + cell.replace(/"/g, '""') + '"';
    }
    return cell;
  };
  const csv = [headers.join(",")]
    .concat(rows.map((row) => headers.map((header) => escapeCell(row[header] ?? "")).join(",")))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadSvgAsPng(svgElement: SVGSVGElement | null, filename: string): void {
  if (!svgElement) {
    return;
  }
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svgElement);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const width = svgElement.clientWidth || Math.round(CHART_HEIGHT * 1.6);
  const height = svgElement.clientHeight || CHART_HEIGHT;
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(url);
      return;
    }
    context.fillStyle =
      getComputedStyle(document.body).getPropertyValue("--tg-theme-bg-color") || "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const pngUrl = canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = filename;
    anchor.click();
  };
  image.src = url;
}

function useResizeObserver<T extends HTMLElement>(ref: RefObject<T>): number {
  const [width, setWidth] = useState<number>(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      setWidth(element.clientWidth || 600);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

type MembersChartProps = {
  buckets: MembersBucket[];
  width: number;
  height: number;
  svgRef: RefObject<SVGSVGElement>;
  gradientId: string;
};

function MembersChart({ buckets, width, height, svgRef, gradientId }: MembersChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(createEmptyTooltip);
  const accentColor = 'var(--tg-theme-accent-text-color, #2563eb)';

  const { points, linePath, areaPath, hasData } = useMemo(() => {
    if (buckets.length === 0) {
      return { points: [], linePath: "", areaPath: "", hasData: false };
    }
    const max = buckets.reduce((maxValue, bucket) => Math.max(maxValue, bucket.value), 0);
    const safeMax = max > 0 ? max : 1;
    const step = buckets.length > 1 ? width / (buckets.length - 1) : 0;
    const centerX = width / 2;
    const computed = buckets.map((bucket, index) => {
      const x = buckets.length === 1 ? centerX : step * index;
      const y = height - (bucket.value / safeMax) * height;
      return { x, y, bucket };
    });
    const path = computed
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    const first = computed[0];
    const last = computed[computed.length - 1];
    const area = path
      ? `${path} L ${(last?.x ?? width).toFixed(2)} ${height} L ${(first?.x ?? 0).toFixed(2)} ${height} Z`
      : "";
    const dataAvailable = computed.some((point) => point.bucket.value > 0);
    return { points: computed, linePath: path, areaPath: area, hasData: dataAvailable };
  }, [buckets, width, height]);

  const handleMouseMove = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      if (points.length === 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const xPosition = event.clientX - rect.left;
      let closest = points[0];
      let minDistance = Math.abs(xPosition - points[0].x);
      for (let index = 1; index < points.length; index += 1) {
        const candidate = points[index];
        const distance = Math.abs(xPosition - candidate.x);
        if (distance < minDistance) {
          minDistance = distance;
          closest = candidate;
        }
      }
      const tooltipY = Math.min(closest.y, height - 12);
      setTooltip({
        visible: true,
        x: closest.x,
        y: tooltipY,
        pointY: closest.y,
        label: closest.bucket.label,
        entries: [
          {
            label: "New members",
            value: formatPersianNumber(closest.bucket.value),
          },
        ],
        bucketIndex: points.indexOf(closest),
      });
    },
    [points, height],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(createEmptyTooltip());
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        className={styles.chartSvg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={accentColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {tooltip.visible && (
          <circle cx={tooltip.x} cy={tooltip.pointY} r={4} fill={accentColor} stroke="#ffffff" strokeWidth={2} />
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </svg>
      {tooltip.visible && (
        <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
          <div>{tooltip.label}</div>
          <ul className={styles.tooltipList}>
            {tooltip.entries.map((entry) => (
              <li key={entry.label}>
                {entry.label}: {entry.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!hasData && (
        <div className={styles.emptyState}>
          <Text weight="2">No data for this range</Text>
          <Text>Try one of the shorter ranges.</Text>
        </div>
      )}
    </>
  );
}

type MessagesChartProps = {
  buckets: MessagesBucket[];
  series: MessagesChartSeries[];
  chartMode: ChartMode;
  width: number;
  height: number;
};

function MessagesChart({ buckets, series, chartMode, width, height }: MessagesChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(createEmptyTooltip);

  const groupWidth = buckets.length > 0 ? width / buckets.length : width;
  const xStep = buckets.length > 1 ? width / (buckets.length - 1) : 0;
  const centerX = width / 2;

  let maxValue = 0;
  buckets.forEach((bucket) => {
    series.forEach((item) => {
      const value = bucket.values[item.type] ?? 0;
      if (value > maxValue) {
        maxValue = value;
      }
    });
  });
  const safeMax = maxValue > 0 ? maxValue : 1;

  const lineSeries = useMemo(() => {
    if (chartMode !== "line") {
      return [] as Array<MessagesChartSeries & { points: Array<{ x: number; y: number; value: number }> ; path: string }>;
    }
    return series.map((item) => {
      const points = buckets.map((bucket, index) => {
        const value = bucket.values[item.type] ?? 0;
        const x = buckets.length === 1 ? centerX : xStep * index;
        const y = height - (value / safeMax) * height;
        return { x, y, value };
      });
      const path = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
      return { ...item, points, path };
    });
  }, [series, buckets, chartMode, centerX, xStep, height, safeMax]);

  const barSpace = groupWidth * 0.7;
  const barWidth = series.length > 0 ? barSpace / series.length : barSpace;
  const barOffset = (groupWidth - barWidth * series.length) / 2;

  const handleHoverIndex = useCallback(
    (index: number) => {
      const bucket = buckets[index];
      if (!bucket) {
        setTooltip(createEmptyTooltip());
        return;
      }
      const center =
        chartMode === "bar"
          ? index * groupWidth + groupWidth / 2
          : buckets.length === 1
            ? centerX
            : xStep * index;
      let peakValue = 0;
      series.forEach((item) => {
        const value = bucket.values[item.type] ?? 0;
        if (value > peakValue) {
          peakValue = value;
        }
      });
      const pointY = height - (peakValue / safeMax) * height;
      const tooltipY = Math.min(pointY, height - 12);
      const entries = series.map((item) => ({
        label: MESSAGE_TYPE_LABELS[item.type],
        value: formatPersianNumber(bucket.values[item.type] ?? 0),
        color: item.color,
      }));
      setTooltip({
        visible: true,
        x: center,
        y: tooltipY,
        pointY,
        label: bucket.label,
        entries,
        bucketIndex: index,
      });
    },
    [buckets, chartMode, groupWidth, centerX, xStep, height, safeMax, series],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      if (buckets.length === 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const xPosition = event.clientX - rect.left;
      if (chartMode === "bar") {
        const index = Math.min(buckets.length - 1, Math.max(0, Math.floor(xPosition / groupWidth)));
        handleHoverIndex(index);
        return;
      }
      let closestIndex = 0;
      let minDistance = Number.POSITIVE_INFINITY;
      buckets.forEach((_bucket, index) => {
        const x = buckets.length === 1 ? centerX : xStep * index;
        const distance = Math.abs(xPosition - x);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = index;
        }
      });
      handleHoverIndex(closestIndex);
    },
    [buckets, chartMode, groupWidth, handleHoverIndex, centerX, xStep],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(createEmptyTooltip());
  }, []);

  return (
    <>
      <svg className={styles.chartSvg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {chartMode === "line" &&
          lineSeries.map((seriesItem) => (
            <path
              key={seriesItem.type}
              d={seriesItem.path}
              fill="none"
              stroke={seriesItem.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        {chartMode === "line" && tooltip.visible && (
          <line
            x1={tooltip.x}
            y1={0}
            x2={tooltip.x}
            y2={height}
            stroke="rgba(15, 23, 42, 0.2)"
            strokeDasharray="4 4"
          />
        )}
        {chartMode === "line" &&
          tooltip.visible &&
          lineSeries.map((seriesItem) => {
            const point = seriesItem.points[tooltip.bucketIndex];
            if (!point) {
              return null;
            }
            return (
              <circle
                key={`${seriesItem.type}-dot`}
                cx={point.x}
                cy={point.y}
                r={4}
                fill={seriesItem.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            );
          })}
        {chartMode === "bar" &&
          buckets.map((bucket, bucketIndex) =>
            series.map((item, seriesIndex) => {
              const value = bucket.values[item.type] ?? 0;
              const barHeight = (value / safeMax) * height;
              const x = bucketIndex * groupWidth + barOffset + seriesIndex * barWidth;
              const y = height - barHeight;
              const isHovered = tooltip.visible && tooltip.bucketIndex === bucketIndex;
              return (
                <rect
                  key={`${bucket.timestamp}-${item.type}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={item.color}
                  opacity={isHovered ? 0.9 : 0.7}
                  rx={Math.min(6, barWidth / 2)}
                />
              );
            }),
          )}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </svg>
      {tooltip.visible && (
        <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
          <div>{tooltip.label}</div>
          <ul className={styles.tooltipList}>
            {tooltip.entries.map((entry) => (
              <li key={entry.label}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: entry.color ?? "#2563eb",
                    }}
                  />
                  {entry.label}:
                </span>{" "}
                {entry.value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function GroupAnalyticsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [analytics, setAnalytics] = useState<GroupAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [rangePreset, setRangePreset] = useState<RangePreset>("7d");
  const [customRange, setCustomRange] = useState<CustomRange>({ from: "", to: "" });
  const [granularity, setGranularity] = useState<AnalyticsGranularity>("day");
  const [selectedMessageTypes, setSelectedMessageTypes] = useState<AnalyticsMessageType[]>(
    () => [...MESSAGE_ORDER],
  );
  const [hiddenSeries, setHiddenSeries] = useState<Set<AnalyticsMessageType>>(new Set());
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [reloadKey, setReloadKey] = useState(0);

  const membersSvgRef = useRef<SVGSVGElement | null>(null);
  const messagesSvgRef = useRef<SVGSVGElement | null>(null);
  const membersContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const membersWidth = useResizeObserver(membersContainerRef);
  const messagesWidth = useResizeObserver(messagesContainerRef);

  const range = useMemo(() => getRange(rangePreset, customRange), [rangePreset, customRange]);
  const allowedGranularities = useMemo(() => getAllowedGranularities(range), [range]);

  useEffect(() => {
    if (!allowedGranularities.includes(granularity)) {
      setGranularity(allowedGranularities[0]);
    }
  }, [allowedGranularities, granularity]);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    if (state.group) {
      setGroup(state.group);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await fetchGroupDetails(groupId);
        if (!cancelled) {
          setGroup(detail.group);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[analytics] failed to load group details", err);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [groupId, state.group]);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchGroupAnalytics(groupId);
        if (cancelled) {
          return;
        }
        setAnalytics(data);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          const normalized = err instanceof Error ? err : new Error(String(err));
          setError(normalized);
          setSnackbar("Failed to fetch analytics data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [groupId, reloadKey]);

  useEffect(() => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      Array.from(next).forEach((type) => {
        if (!selectedMessageTypes.includes(type)) {
          next.delete(type);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [selectedMessageTypes]);

  const timezone = analytics?.timezone ?? "UTC";

  const previousRange = useMemo<DateRange>(() => {
    const duration = Math.max(1, range.to.getTime() - range.from.getTime());
    const to = new Date(range.from.getTime() - 1);
    const from = new Date(to.getTime() - duration);
    return { from, to };
  }, [range]);

  const membersBuckets = useMemo<MembersBucket[]>(() => {
    if (!analytics) {
      return [];
    }
    return aggregatePoints(analytics.members, range, granularity).map((point) => ({
      timestamp: point.timestamp,
      value: point.value,
      label: bucketLabel(new Date(point.timestamp), granularity, timezone),
    }));
  }, [analytics, range, granularity, timezone]);

  const membersTotal = useMemo(
    () => membersBuckets.reduce((total, bucket) => total + bucket.value, 0),
    [membersBuckets],
  );

  const previousMembersTotal = useMemo(() => {
    if (!analytics) {
      return 0;
    }
    const previousPoints = aggregatePoints(analytics.members, previousRange, granularity);
    return sumPoints(previousPoints);
  }, [analytics, previousRange, granularity]);

  const membersTrend = useMemo(
    () => calculateTrend(membersTotal, previousMembersTotal),
    [membersTotal, previousMembersTotal],
  );

  const messagesData = useMemo<{
    buckets: MessagesBucket[];
    series: MessagesChartSeries[];
    totalsByType: Map<AnalyticsMessageType, number>;
  }>(() => {
    if (!analytics) {
      return {
        buckets: [] as MessagesBucket[],
        series: [] as MessagesChartSeries[],
        totalsByType: new Map<AnalyticsMessageType, number>(),
      };
    }

    const selected = MESSAGE_ORDER.filter((type) => selectedMessageTypes.includes(type));

    const aggregatedSeries: Array<{
      type: AnalyticsMessageType;
      color: string;
      map: Map<string, number>;
      total: number;
    }> = selected.map((type) => {
      const baseSeries = analytics.messages.find((seriesItem) => seriesItem.type === type);
      const points = baseSeries ? aggregatePoints(baseSeries.points, range, granularity) : [];
      const map = new Map(points.map((point) => [point.timestamp, point.value]));
      return {
        type,
        color: MESSAGE_TYPE_COLORS[type],
        map,
        total: sumPoints(points),
      };
    });

    const timestamps = new Set<string>();
    aggregatedSeries.forEach((seriesItem) => {
      seriesItem.map.forEach((_value, key) => {
        timestamps.add(key);
      });
    });

    const sortedTimestamps = Array.from(timestamps).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );

    const buckets: MessagesBucket[] = sortedTimestamps.map((timestamp) => {
      const label = bucketLabel(new Date(timestamp), granularity, timezone);
      const values: Record<AnalyticsMessageType, number> = {} as Record<AnalyticsMessageType, number>;
      aggregatedSeries.forEach((seriesItem) => {
        values[seriesItem.type] = seriesItem.map.get(timestamp) ?? 0;
      });
      return { timestamp, label, values };
    });

    const totalsByType = new Map<AnalyticsMessageType, number>();
    aggregatedSeries.forEach((seriesItem) => {
      totalsByType.set(seriesItem.type, seriesItem.total);
    });

    const seriesForChart: MessagesChartSeries[] = aggregatedSeries.map((seriesItem) => ({
      type: seriesItem.type,
      color: seriesItem.color,
    }));

    return { buckets, series: seriesForChart, totalsByType };
  }, [analytics, granularity, range, selectedMessageTypes, timezone]);

  const visibleMessageSeries: MessagesChartSeries[] = useMemo(() =>
    messagesData.series.filter((seriesItem) => !hiddenSeries.has(seriesItem.type)),
    [messagesData, hiddenSeries],
  ) as MessagesChartSeries[];

  const currentMessagesTotal = useMemo(() => {
    let total = 0;
    messagesData.totalsByType.forEach((value) => {
      total += value;
    });
    return total;
  }, [messagesData]);

  const previousMessagesTotal = useMemo(() => {
    if (!analytics) {
      return 0;
    }
    let total = 0;
    selectedMessageTypes.forEach((type) => {
      const baseSeries = analytics.messages.find((seriesItem) => seriesItem.type === type);
      if (!baseSeries) {
        return;
      }
      const previousPoints = aggregatePoints(baseSeries.points, previousRange, granularity);
      total += sumPoints(previousPoints);
    });
    return total;
  }, [analytics, selectedMessageTypes, previousRange, granularity]);

  const messagesTrend = useMemo(
    () => calculateTrend(currentMessagesTotal, previousMessagesTotal),
    [currentMessagesTotal, previousMessagesTotal],
  );

  const topMessageType = useMemo<AnalyticsMessageType | null>(() => {
    let bestType: AnalyticsMessageType | null = null;
    let bestValue = -Infinity;
    messagesData.totalsByType.forEach((value, type) => {
      if (value > bestValue) {
        bestType = type;
        bestValue = value;
      }
    });
    return bestType;
  }, [messagesData]);

  const averageMessagesPerDay = useMemo(() => {
    const durationMs = range.to.getTime() - range.from.getTime();
    const days = Math.max(1, Math.round(durationMs / DAY_MS) + 1);
    return Math.round(currentMessagesTotal / days);
  }, [range, currentMessagesTotal]);

  const hasMembersData = membersBuckets.some((bucket) => bucket.value > 0);
  const hasMessagesData = messagesData.buckets.some((bucket) =>
    visibleMessageSeries.some((seriesItem) => (bucket.values[seriesItem.type] ?? 0) > 0),
  );

  const rawMembersGradientId = useId();
  const membersGradientId = useMemo(
    () => rawMembersGradientId.replace(/:/g, "-"),
    [rawMembersGradientId],
  );

  const handleReload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const handleMenuSelect = useCallback(
    (key: string) => {
      if (!groupId) {
        return;
      }
      switch (key) {
        case "home":
          navigate(`/groups/${groupId}`, { state: { group } });
          break;
        case "settings":
          navigate(`/groups/${groupId}/settings/general`, { state: { group } });
          break;
        case "bans":
          navigate(`/groups/${groupId}/settings/bans`, { state: { group } });
          break;
        case "limits":
          navigate(`/groups/${groupId}/settings/limits`, { state: { group } });
          break;
        case "mute":
          navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
          break;
        case "mandatory":
          navigate(`/groups/${groupId}/settings/mandatory`, { state: { group } });
          break;
        case "texts":
          navigate(`/groups/${groupId}/settings/texts`, { state: { group } });
          break;
        case "analytics":
          break;
        case "giveaway":
          navigate("/giveaways/create", { state: { focusGroupId: groupId } });
          break;
        case "stars":
          navigate("/stars", { state: { focusGroupId: groupId } });
          break;
        default:
          console.info(`[group-analytics] menu item '${key}' selected`);
      }
    },
    [groupId, group, navigate],
  );

  const handleCustomRangeChange = useCallback((field: keyof CustomRange, value: string) => {
    setCustomRange((prev) => ({ ...prev, [field]: value }));
    setRangePreset("custom");
  }, []);

  const handleMessageTypeToggle = useCallback((type: AnalyticsMessageType) => {
    setSelectedMessageTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((item) => item !== type);
        if (next.length === 0) {
          return prev;
        }
        return next;
      }
      const next = [...prev, type];
      next.sort((a, b) => MESSAGE_ORDER.indexOf(a) - MESSAGE_ORDER.indexOf(b));
      return next;
    });
  }, []);

  const handleLegendToggle = useCallback((type: AnalyticsMessageType) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleDownloadMembersCsv = useCallback(() => {
    if (!membersBuckets.length) {
      return;
    }
    const rows = membersBuckets.map((bucket) => ({
      timestamp: bucket.timestamp,
      label: bucket.label,
      value: bucket.value,
    }));
    downloadCsv("members-analytics.csv", rows);
  }, [membersBuckets]);

  const handleDownloadMembersImage = useCallback(() => {
    downloadSvgAsPng(membersSvgRef.current, "members-analytics.png");
  }, []);

  const handleDownloadMessagesCsv = useCallback(() => {
    if (!messagesData.buckets.length) {
      return;
    }
    const rows = messagesData.buckets.map((bucket) => {
      const row: Record<string, string | number> = {
        timestamp: bucket.timestamp,
        label: bucket.label,
      };
      selectedMessageTypes.forEach((type) => {
        row[type] = bucket.values[type] ?? 0;
      });
      return row;
    });
    downloadCsv("messages-analytics.csv", rows);
  }, [messagesData, selectedMessageTypes]);

  const handleDownloadMessagesImage = useCallback(() => {
    downloadSvgAsPng(messagesSvgRef.current, "messages-analytics.png");
  }, []);

  const membersTrendClass =
    membersTrend.direction === "down"
      ? styles.summaryTrendNegative
      : membersTrend.direction === "up"
        ? styles.summaryTrendPositive
        : undefined;

  const messagesTrendClass =
    messagesTrend.direction === "down"
      ? styles.summaryTrendNegative
      : messagesTrend.direction === "up"
        ? styles.summaryTrendPositive
        : undefined;

  const summaryCards = (
    <div className={styles.summaryGrid}>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Total new members</span>
        <span className={styles.summaryValue}>{formatPersianNumber(membersTotal)}</span>
        <span className={membersTrendClass}>{formatPercent(membersTrend)}</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Total group messages</span>
        <span className={styles.summaryValue}>{formatPersianNumber(currentMessagesTotal)}</span>
        <span className={messagesTrendClass}>{formatPercent(messagesTrend)}</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Average daily messages</span>
        <span className={styles.summaryValue}>{formatPersianNumber(averageMessagesPerDay)}</span>
        <span className={styles.summaryLabel}>Within the selected range</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Most used message type</span>
        <span className={styles.summaryValue}>
          {topMessageType ? MESSAGE_TYPE_LABELS[topMessageType] : "-"}
        </span>
        <span className={styles.summaryLabel}>Based on active filter</span>
      </div>
    </div>
  );

  const filters = (
    <div className={styles.filtersCard}>
      <div className={styles.filterRow}>
        <Text weight="2">Date range</Text>
        <div className={styles.rangeButtons}>
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.key}
              mode={rangePreset === option.key ? "filled" : "outline"}
              size="s"
              onClick={() => setRangePreset(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {rangePreset === "custom" && (
          <div className={styles.dateInputs}>
            <input
              type="date"
              value={customRange.from}
              onChange={(event) => handleCustomRangeChange("from", event.target.value)}
            />
            <span>to</span>
            <input
              type="date"
              value={customRange.to}
              onChange={(event) => handleCustomRangeChange("to", event.target.value)}
            />
          </div>
        )}
      </div>
      <div className={styles.filterRow}>
        <Text weight="2">Granularity</Text>
        <div className={styles.granularityButtons}>
          {GRANULARITY_ORDER.filter((item) => allowedGranularities.includes(item)).map((item) => (
            <Button
              key={item}
              mode={granularity === item ? "filled" : "outline"}
              size="s"
              onClick={() => setGranularity(item)}
            >
              {GRANULARITY_LABELS[item]}
            </Button>
          ))}
        </div>
      </div>
      <div className={styles.filterRow}>
        <Text weight="2">Message data set</Text>
        <div className={styles.messageFilters}>
          {MESSAGE_ORDER.map((type) => (
            <label key={type} className={styles.messageFilter}>
              <input
                type="checkbox"
                checked={selectedMessageTypes.includes(type)}
                onChange={() => handleMessageTypeToggle(type)}
              />
              <span>{MESSAGE_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className={styles.filterRow}>
        <Text weight="2">Show messages chart</Text>
        <div className={styles.viewButtons}>
          <Button
            mode={chartMode === "line" ? "filled" : "outline"}
            size="s"
            onClick={() => setChartMode("line")}
          >
            Line
          </Button>
          <Button
            mode={chartMode === "bar" ? "filled" : "outline"}
            size="s"
            onClick={() => setChartMode("bar")}
          >
            Bar
          </Button>
        </div>
      </div>
    </div>
  );

  const membersChartSection = (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartHeaderTop}>
          <Title level="3" className={styles.chartTitle}>
            New members
          </Title>
          <span className={membersTrendClass}>{formatPercent(membersTrend)}</span>
        </div>
        <Text weight="2">Number of new members in the selected range by granularity</Text>
      </div>
      <div ref={membersContainerRef} className={styles.chartContainer}>
        {loading && !analytics ? (
          <div className={styles.skeleton} />
        ) : hasMembersData ? (
          <MembersChart
            buckets={membersBuckets}
            width={membersWidth}
            height={CHART_HEIGHT}
            svgRef={membersSvgRef}
            gradientId={membersGradientId}
          />
        ) : (
          <div className={styles.emptyState}>
            <Text weight="2">No data for this range</Text>
            <Button mode="plain" size="s" onClick={() => setRangePreset("7d")}>
              Change range
            </Button>
          </div>
        )}
      </div>
      <div className={styles.downloadBar}>
        <Button mode="plain" size="s" onClick={handleDownloadMembersCsv}>
          Download CSV
        </Button>
        <Button mode="plain" size="s" onClick={handleDownloadMembersImage}>
          Download PNG
        </Button>
      </div>
    </div>
  );

  const messagesChartSection = (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartHeaderTop}>
          <Title level="3" className={styles.chartTitle}>
            Group messages
          </Title>
          <span className={messagesTrendClass}>{formatPercent(messagesTrend)}</span>
        </div>
        <Text weight="2">Messages by type with active filters</Text>
        <div className={styles.chartLegend}>
          {messagesData.series.map((seriesItem) => {
            const hidden = hiddenSeries.has(seriesItem.type);
            return (
              <button
                key={seriesItem.type}
                type="button"
                className={`${styles.legendItem} ${hidden ? styles.hiddenSeries : ""}`}
                onClick={() => handleLegendToggle(seriesItem.type)}
              >
                <span
                  className={styles.legendSwatch}
                  style={{ background: MESSAGE_TYPE_COLORS[seriesItem.type] }}
                />
                {MESSAGE_TYPE_LABELS[seriesItem.type]}
              </button>
            );
          })}
        </div>
      </div>
      <div ref={messagesContainerRef} className={styles.chartContainer}>
        {loading && !analytics ? (
          <div className={styles.skeleton} />
        ) : hasMessagesData ? (
          <MessagesChart
            buckets={messagesData.buckets}
            series={visibleMessageSeries}
            chartMode={chartMode}
            width={messagesWidth}
            height={CHART_HEIGHT}
          />
        ) : (
          <div className={styles.emptyState}>
            <Text weight="2">No data for this range</Text>
            <Button mode="plain" size="s" onClick={() => setRangePreset("7d")}>
              Change range
            </Button>
          </div>
        )}
      </div>
      <div className={styles.downloadBar}>
        <Button mode="plain" size="s" onClick={handleDownloadMessagesCsv}>
          Download CSV
        </Button>
        <Button mode="plain" size="s" onClick={handleDownloadMessagesImage}>
          Download PNG
        </Button>
      </div>
    </div>
  );

  const bodyContent = (() => {
    if (loading && !analytics) {
      return (
        <>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </>
      );
    }
    if (error && !analytics) {
      const errorMessage = error.message || "Unknown error occurred";
      const isAccessError = errorMessage.includes("access") || errorMessage.includes("403");
      const isNotFoundError = errorMessage.includes("not found") || errorMessage.includes("404");
      const hasGroupContext = Boolean(group);

      let header = "Analytics Unavailable";
      let description = "Unable to load analytics data for this group.";

      if (isAccessError) {
        header = "Access Denied";
        description = "You don't have permission to view analytics for this group.";
      } else if (isNotFoundError && !hasGroupContext) {
        header = "Group Not Found";
        description = "This group was not found or is no longer available.";
      } else if (isNotFoundError && hasGroupContext) {
        header = "Analytics Not Available";
        description = "Analytics are not yet available for this group. Please try again later.";
      } else {
        description = `${description} Error: ${errorMessage}`;
      }

      return (
        <Placeholder
          header={header}
          action={
            <div className={styles.placeholderActions}>
              <Button mode="filled" size="s" onClick={handleReload}>
                Try again
              </Button>
              <Button mode="outline" size="s" onClick={() => navigate('/groups')}>
                Back to My Groups
              </Button>
            </div>
          }
        >
          {description}
        </Placeholder>
      );
    }
    return (
      <>
        {filters}
        {summaryCards}
        {membersChartSection}
        {messagesChartSection}
      </>
    );
  })();

  return (
    <div className={styles.page} dir="ltr">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <IconButton
            aria-label="Back"
            onClick={() => navigate(-1)}
            className={styles.backButton}
          >
            <span className={styles.backIcon} aria-hidden="true" />
          </IconButton>
        </div>
        <div className={styles.headerCenter}>
          <Avatar
            size={48}
            src={group?.photoUrl ?? undefined}
            acronym={group?.photoUrl ? undefined : group?.title?.charAt(0).toUpperCase() ?? "A"}
            alt={group?.title ?? "group"}
          />
          <div className={styles.headerTitles}>
            <Title level="3" className={styles.groupName}>
              {group ? group.title : "Unknown group"}
            </Title>
            <Text weight="2" className={styles.groupSubtitle}>
              Group analytics
            </Text>
          </div>
        </div>
        <div className={styles.headerRight}>
          <IconButton
            aria-label="Group menu"
            onClick={() => setMenuOpen(true)}
            className={styles.menuButton}
          >
            <span className={styles.burger}>
              <span />
              <span />
              <span />
            </span>
          </IconButton>
        </div>
      </header>
      <main className={styles.body}>{bodyContent}</main>
      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="analytics"
        onSelect={handleMenuSelect}
      />
      {snackbar && (
        <Snackbar duration={4000} onClose={() => setSnackbar(null)}>
          {snackbar}
        </Snackbar>
      )}
    </div>
  );
}





















