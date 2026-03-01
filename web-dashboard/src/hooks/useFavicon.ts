import { useState, useEffect } from 'react';

export function useFavicon(domain: string | undefined) {
    const [iconUrl, setIconUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!domain) return;

        let isMounted = true;
        const fetchIcon = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/icons?domain=${encodeURIComponent(domain)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) setIconUrl(data.faviconUrl);
                } else {
                    if (isMounted) setError('Icon not found');
                }
            } catch (err: any) {
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchIcon();
        return () => { isMounted = false; };
    }, [domain]);

    return { iconUrl, loading, error };
}
