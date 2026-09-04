import React from 'react';

interface MicroSparklineProps {
    samples?: number[];
    width?: number;
    height?: number;
    className?: string;
    strokeColor?: string;
}

export const MicroSparkline: React.FC<MicroSparklineProps> = ({
    samples = [],
    width = 64,
    height = 18,
    className = '',
    strokeColor
}) => {
    if (!samples || samples.length < 2) {
        return (
            <div className={`inline-flex items-center justify-center opacity-30 ${className}`} style={{ width, height }}>
                <svg width={width} height={height} className="overflow-visible">
                    <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                </svg>
            </div>
        );
    }

    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const range = max - min === 0 ? 1 : max - min;
    const padding = 2;
    const effHeight = height - padding * 2;

    const points = samples.map((val, idx) => {
        const x = (idx / (samples.length - 1)) * width;
        const y = height - padding - ((val - min) / range) * effHeight;
        return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), val };
    });

    const pathD = points.reduce((acc, p, idx) => {
        return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

    // Dynamic color determination based on latest / max value
    const latestVal = samples[samples.length - 1];
    const defaultColor = latestVal > 500 ? '#f43f5e' : latestVal > 100 ? '#f59e0b' : '#06b6d4';
    const color = strokeColor || defaultColor;

    const lastPoint = points[points.length - 1];

    return (
        <div className={`inline-flex items-center group relative cursor-pointer ${className}`} title={`Latest: ${latestVal}ms (Min: ${min}ms, Max: ${max}ms)`}>
            <svg width={width} height={height} className="overflow-visible">
                <defs>
                    <linearGradient id={`spark-grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.0" />
                    </linearGradient>
                </defs>
                {/* Gradient area under curve */}
                <path d={areaD} fill={`url(#spark-grad-${color.replace('#', '')})`} />
                {/* Main line */}
                <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {/* Crisp endpoint indicator */}
                <circle cx={lastPoint.x} cy={lastPoint.y} r="2" fill={color} />
                <circle cx={lastPoint.x} cy={lastPoint.y} r="3.5" fill={color} opacity="0.25" />
            </svg>
        </div>
    );
};
