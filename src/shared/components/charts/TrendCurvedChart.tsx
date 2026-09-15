import React, { useState, useRef, useMemo } from 'react';
import { toPersianDigits, formatPersianToman } from '../../utils/numberUtils';
import { Crown, Users, TrendingUp, Sparkles, CreditCard, Flame } from 'lucide-react';

export interface AnalyticsBucket {
  key: string;
  label: string;
  subLabel?: string;
  signups: number;
  vipConversions: number;
  revenue?: number;
  conversionRate?: number;
  isCurrentPeriod?: boolean;
}

export interface TrendCurvedChartProps {
  buckets: AnalyticsBucket[];
  windowSignups: number;
  windowVips: number;
  windowConversionRate: number;
  windowRevenue: number;
  windowActiveUsers: number;
  windowAOV: number;
  timeRangeLabel: string;
}

// Generate smooth cubic Bézier spline path through coordinates
function generateCurvedPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Cubic Bézier conversion
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return d;
}

export const TrendCurvedChart: React.FC<TrendCurvedChartProps> = ({
  buckets,
  windowSignups,
  windowVips,
  windowConversionRate,
  windowRevenue,
  windowActiveUsers,
  windowAOV,
  timeRangeLabel
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // SVG Dimension Constants
  const viewBoxWidth = 840;
  const viewBoxHeight = 240;
  const paddingX = 42;
  const paddingTop = 30;
  const paddingBottom = 45;
  const plotWidth = viewBoxWidth - paddingX * 2;
  const plotHeight = viewBoxHeight - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  // Compute Volume Scaling
  const maxVolume = useMemo(() => {
    const maxVal = Math.max(
      1,
      ...buckets.map(b => b.signups),
      ...buckets.map(b => b.vipConversions)
    );
    // 20% headroom so peak point doesn't touch the top
    return Math.ceil(maxVal * 1.25);
  }, [buckets]);

  // Map Data to SVG Coordinates
  const { signupPoints, vipPoints, xCoords } = useMemo(() => {
    const count = buckets.length;
    if (count === 0) return { signupPoints: [], vipPoints: [], xCoords: [] };

    const xCoordsArr: number[] = [];
    const sPoints: { x: number; y: number }[] = [];
    const vPoints: { x: number; y: number }[] = [];

    buckets.forEach((b, index) => {
      const x = count === 1 
        ? paddingX + plotWidth / 2 
        : paddingX + (index / (count - 1)) * plotWidth;

      const ySignups = Math.max(
        paddingTop,
        baselineY - (b.signups / maxVolume) * plotHeight
      );
      const yVip = Math.max(
        paddingTop,
        baselineY - (b.vipConversions / maxVolume) * plotHeight
      );

      xCoordsArr.push(x);
      sPoints.push({ x, y: ySignups });
      vPoints.push({ x, y: yVip });
    });

    return { signupPoints: sPoints, vipPoints: vPoints, xCoords: xCoordsArr };
  }, [buckets, maxVolume, baselineY, plotHeight, plotWidth, paddingX, paddingTop]);

  // Generate SVG Spline and Area Paths
  const signupLinePath = useMemo(() => generateCurvedPath(signupPoints), [signupPoints]);
  const vipLinePath = useMemo(() => generateCurvedPath(vipPoints), [vipPoints]);

  const signupAreaPath = useMemo(() => {
    if (signupPoints.length < 2) return '';
    const lastX = signupPoints[signupPoints.length - 1].x;
    const firstX = signupPoints[0].x;
    return `${signupLinePath} L ${lastX.toFixed(1)} ${baselineY} L ${firstX.toFixed(1)} ${baselineY} Z`;
  }, [signupLinePath, signupPoints, baselineY]);

  const vipAreaPath = useMemo(() => {
    if (vipPoints.length < 2) return '';
    const lastX = vipPoints[vipPoints.length - 1].x;
    const firstX = vipPoints[0].x;
    return `${vipLinePath} L ${lastX.toFixed(1)} ${baselineY} L ${firstX.toFixed(1)} ${baselineY} Z`;
  }, [vipLinePath, vipPoints, baselineY]);

  // Handle pointer tracking for closest point
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!containerRef.current || buckets.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const targetX = ratio * viewBoxWidth;

    // Find nearest point
    let closestIdx = 0;
    let minDiff = Infinity;
    xCoords.forEach((x, idx) => {
      const diff = Math.abs(x - targetX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoveredIndex(closestIdx);
  };

  const handlePointerLeave = () => {
    setHoveredIndex(null);
  };

  const activeBucket = hoveredIndex !== null && buckets[hoveredIndex] ? buckets[hoveredIndex] : null;

  return (
    <div className="surface-z1 border-standard radius-card p-4 sm:p-5 space-y-4 shadow-subtle relative overflow-hidden">
      {/* Header & Integrated Macro Window Metrics (Seamless, no divider cuts) */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 radius-control bg-amber-subtle text-amber flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-xs sm:text-sm text-role-primary">
                روند مقایسه‌ای و پیوسته جذب و تبدیل به VIP
              </h3>
              <p className="text-[11px] text-role-secondary mt-0.5">
                جریان پیوسته تغییرات حجم ورودی و نرخ تبدیل سامورایی‌ها در {timeRangeLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Legend Pills & Stream Identity */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control">
            <span className="w-2.5 h-2.5 radius-full bg-zinc-200 shadow-sm" />
            <span className="text-role-primary font-medium text-[11px]">ثبت‌نام جدید</span>
          </div>
          <div className="flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control">
            <span className="w-2.5 h-2.5 radius-full bg-amber shadow-sm" />
            <span className="text-amber font-bold text-[11px]">تبدیل سامورایی VIP</span>
          </div>
        </div>
      </div>

      {/* Integrated Macro Metric Badges (Replaces the 4 duplicate bulky cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="surface-z2 radius-component p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-role-secondary">
            <span>ثبت‌نام در بازه</span>
            <Users className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-role-primary font-mono">
              {toPersianDigits(windowSignups)}
            </span>
            <span className="text-[10px] text-role-muted">کاربر جدید</span>
          </div>
        </div>

        <div className="surface-z2 radius-component p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-role-secondary">
            <span>تبدیل به VIP</span>
            <Crown className="w-3.5 h-3.5 text-amber" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-amber font-mono">
              {toPersianDigits(windowVips)}
            </span>
            <span className="text-[10px] text-amber/80 font-bold">
              ({toPersianDigits(windowConversionRate)}٪ تبدیل)
            </span>
          </div>
        </div>

        <div className="surface-z2 radius-component p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-role-secondary">
            <span>درآمد تحقق‌یافته</span>
            <CreditCard className="w-3.5 h-3.5 text-emerald" />
          </div>
          <div className="mt-2">
            <span className="text-lg font-black text-emerald font-mono">
              {formatPersianToman(windowRevenue)}
            </span>
          </div>
        </div>

        <div className="surface-z2 radius-component p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-role-secondary">
            <span>کاربران فعال نبرد</span>
            <Flame className="w-3.5 h-3.5 text-orange" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-orange font-mono">
              {toPersianDigits(windowActiveUsers)}
            </span>
            <span className="text-[10px] text-role-muted">جنگجوی فعال</span>
          </div>
        </div>
      </div>

      {/* Curved Spline Chart Area */}
      <div 
        ref={containerRef}
        className="relative w-full overflow-hidden select-none touch-none pt-2"
      >
        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className="w-full h-48 sm:h-64 overflow-visible"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            {/* Soft Ambient Linear Gradients */}
            <linearGradient id="gradient-signups" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4f4f5" stopOpacity="0.22" />
              <stop offset="85%" stopColor="#f4f4f5" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#f4f4f5" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="gradient-vip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.38" />
              <stop offset="85%" stopColor="#fbbf24" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
            </linearGradient>

            <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Grid Lines (Subtle horizontal guidelines) */}
          {[0, 0.33, 0.66, 1].map((ratio) => {
            const y = paddingTop + (1 - ratio) * plotHeight;
            const value = Math.round(ratio * maxVolume);
            return (
              <g key={ratio}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={viewBoxWidth - paddingX}
                  y2={y}
                  stroke="rgba(63, 63, 70, 0.3)"
                  strokeDasharray="4 6"
                  strokeWidth="1"
                />
                <text
                  x={paddingX - 10}
                  y={y + 4}
                  fill="#71717a"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="inherit"
                  className="font-mono select-none"
                >
                  {toPersianDigits(value)}
                </text>
              </g>
            );
          })}

          {/* Filled Area Under Spline Curves */}
          {signupAreaPath && (
            <path
              d={signupAreaPath}
              fill="url(#gradient-signups)"
              className="transition-opacity duration-300 pointer-events-none"
            />
          )}
          {vipAreaPath && (
            <path
              d={vipAreaPath}
              fill="url(#gradient-vip)"
              className="transition-opacity duration-300 pointer-events-none"
            />
          )}

          {/* Smooth Continuous Spline Lines */}
          {signupLinePath && (
            <path
              d={signupLinePath}
              fill="none"
              stroke="#e4e4e7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300"
            />
          )}
          {vipLinePath && (
            <path
              d={vipLinePath}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#glow-amber)"
              className="transition-all duration-300"
            />
          )}

          {/* Interactive Guide Line and Floating Point Rings on Hover */}
          {hoveredIndex !== null && xCoords[hoveredIndex] !== undefined && (
            <g className="transition-all duration-150">
              {/* Vertical Crosshair Line */}
              <line
                x1={xCoords[hoveredIndex]}
                y1={paddingTop - 5}
                x2={xCoords[hoveredIndex]}
                y2={baselineY}
                stroke="#a1a1aa"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />

              {/* Signups Indicator Dot */}
              <circle
                cx={signupPoints[hoveredIndex]?.x}
                cy={signupPoints[hoveredIndex]?.y}
                r="6"
                fill="#ffffff"
                stroke="#18181b"
                strokeWidth="2"
                className="transition-all duration-150"
              />

              {/* VIP Conversions Indicator Dot */}
              <circle
                cx={vipPoints[hoveredIndex]?.x}
                cy={vipPoints[hoveredIndex]?.y}
                r="7"
                fill="#fbbf24"
                stroke="#18181b"
                strokeWidth="2.5"
                filter="url(#glow-amber)"
                className="transition-all duration-150"
              />
            </g>
          )}

          {/* X-Axis Date Labels along the Bottom */}
          {buckets.map((b, idx) => {
            const x = xCoords[idx];
            if (x === undefined) return null;
            const isHovered = hoveredIndex === idx;

            // Skip some labels on dense charts to avoid crowding
            const shouldRenderLabel = 
              buckets.length <= 8 || 
              idx === 0 || 
              idx === buckets.length - 1 || 
              idx % Math.ceil(buckets.length / 7) === 0;

            if (!shouldRenderLabel && !isHovered) return null;

            return (
              <text
                key={b.key}
                x={x}
                y={baselineY + 20}
                fill={isHovered ? '#fbbf24' : '#a1a1aa'}
                fontSize={isHovered ? '11' : '10'}
                fontWeight={isHovered ? 'bold' : 'normal'}
                textAnchor="middle"
                fontFamily="inherit"
                className="select-none transition-colors"
              >
                {b.label}
              </text>
            );
          })}
        </svg>

        {/* Floating Tooltip Box on Active Hover */}
        {activeBucket && hoveredIndex !== null && xCoords[hoveredIndex] !== undefined && (
          <div
            style={{
              left: `${Math.max(12, Math.min(88, (xCoords[hoveredIndex] / viewBoxWidth) * 100))}%`,
              transform: 'translateX(-50%)',
              top: '8px'
            }}
            className="absolute z-20 pointer-events-none surface-z2 border-standard radius-card px-3.5 py-2.5 shadow-tactical text-xs backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 min-w-[190px]"
          >
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-800/60 font-bold text-role-primary">
              <span>{activeBucket.label}</span>
              {activeBucket.subLabel && (
                <span className="text-[10px] text-role-muted font-mono font-normal">
                  {activeBucket.subLabel}
                </span>
              )}
            </div>

            <div className="space-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-role-secondary">
                  <span className="w-2 h-2 radius-full bg-zinc-300" />
                  <span>ثبت‌نام جدید:</span>
                </span>
                <span className="font-mono font-bold text-role-primary">
                  {toPersianDigits(activeBucket.signups)} نفر
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber">
                  <span className="w-2 h-2 radius-full bg-amber" />
                  <span>تبدیل VIP:</span>
                </span>
                <span className="font-mono font-bold text-amber">
                  {toPersianDigits(activeBucket.vipConversions)} نفر
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 text-role-muted text-[10px]">
                <span>نرخ تبدیل این مقطع:</span>
                <span className="font-mono font-bold text-emerald">
                  {toPersianDigits(activeBucket.conversionRate || 0)}٪
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Insight (Seamless without harsh divider line) */}
      <div className="surface-z2 radius-component p-3 text-xs text-role-secondary flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber shrink-0" />
          <span>
            در بازه انتخابی ({timeRangeLabel})، نرخ تبدیل کلی{' '}
            <strong className="text-role-primary">{toPersianDigits(windowConversionRate)}٪</strong> با مجموع درآمد{' '}
            <strong className="text-emerald">{formatPersianToman(windowRevenue)}</strong> و میانگین هر خرید{' '}
            <strong className="text-role-primary">{formatPersianToman(windowAOV)}</strong> ثبت گردیده است.
          </span>
        </div>
        <span className="text-[11px] text-role-muted font-mono shrink-0">
          مبنا: تقویم هجری شمسی و لاگ‌های دیتابیس
        </span>
      </div>
    </div>
  );
};
