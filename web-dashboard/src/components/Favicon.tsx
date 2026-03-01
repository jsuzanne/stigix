import React from 'react';
import { useFavicon } from '../hooks/useFavicon';
import { clsx } from 'clsx';
import { Mail, Globe } from 'lucide-react';

interface FaviconProps {
    domain: string;
    className?: string;
    size?: number;
}

export const Favicon: React.FC<FaviconProps> = ({ domain, className, size = 16 }) => {
    const { iconUrl, loading } = useFavicon(domain);
    const [imgError, setImgError] = React.useState(false);

    const getFallbackColor = (str: string) => {
        const colors = [
            'bg-blue-500', 'bg-purple-500', 'bg-cyan-500',
            'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500',
            'bg-rose-500', 'bg-violet-500'
        ];
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    };

    const isMail = domain.toLowerCase().includes('mail') || domain.toLowerCase().includes('outlook');

    if (loading) {
        return (
            <div
                className={clsx("rounded-full bg-border/30 animate-pulse flex-shrink-0", className)}
                style={{ width: size, height: size }}
            />
        );
    }

    if (iconUrl && !imgError) {
        return (
            <img
                src={iconUrl}
                alt=""
                className={clsx("rounded-sm object-contain flex-shrink-0", className)}
                style={{ width: size, height: size }}
                onError={() => setImgError(true)}
            />
        );
    }

    return (
        <div
            className={clsx(
                "rounded-full flex items-center justify-center text-white flex-shrink-0 shadow-sm",
                getFallbackColor(domain),
                className
            )}
            style={{ width: size, height: size }}
        >
            {isMail ? (
                <Mail size={size * 0.6} strokeWidth={3} />
            ) : (
                <Globe size={size * 0.6} strokeWidth={3} />
            )}
        </div>
    );
};
