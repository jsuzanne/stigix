import { useState, useEffect } from 'react';

export const useSecurityScores = (token: string) => {
    const [scores, setScores] = useState<any[]>([]);
    const [urlBaseline, setUrlBaseline] = useState<any>(null);
    const [dnsBaseline, setDnsBaseline] = useState<any>(null);
    const [threatBaseline, setThreatBaseline] = useState<any>(null);
    const [urlDiff, setUrlDiff] = useState<any>(null);
    const [dnsDiff, setDnsDiff] = useState<any>(null);
    const [threatDiff, setThreatDiff] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const authHeader = { 'Authorization': `Bearer ${token}` };

    const fetchData = async () => {
        try {
            const res = await fetch('/api/security/scores', { headers: authHeader });
            if (res.ok) setScores(await res.json());

            const urlBaselineRes = await fetch('/api/security/scores/baseline?type=url', { headers: authHeader });
            if (urlBaselineRes.ok) setUrlBaseline(await urlBaselineRes.json());
            else setUrlBaseline(null);

            const dnsBaselineRes = await fetch('/api/security/scores/baseline?type=dns', { headers: authHeader });
            if (dnsBaselineRes.ok) setDnsBaseline(await dnsBaselineRes.json());
            else setDnsBaseline(null);

            const threatBaselineRes = await fetch('/api/security/scores/baseline?type=threat', { headers: authHeader });
            if (threatBaselineRes.ok) setThreatBaseline(await threatBaselineRes.json());
            else setThreatBaseline(null);
        } catch (e) {
            console.error('Failed to fetch score dashboard data', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchDiff = async (type: 'url' | 'dns' | 'threat') => {
        if (!scores.length) return;
        const latest = scores[0];
        const baseline = type === 'url' ? urlBaseline : type === 'dns' ? dnsBaseline : threatBaseline;
        if (!baseline || !latest) return;

        try {
            const res = await fetch(`/api/security/scores/diff?type=${type}&from=${baseline.runId}&to=${latest.runId}`, { headers: authHeader });
            if (res.ok) {
                const data = await res.json();
                if (type === 'url') setUrlDiff(data);
                else if (type === 'dns') setDnsDiff(data);
                else setThreatDiff(data);
            }
        } catch(e) {}
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        if (!loading && urlBaseline) fetchDiff('url');
        if (!loading && dnsBaseline) fetchDiff('dns');
        if (!loading && threatBaseline) fetchDiff('threat');
    }, [scores, urlBaseline, dnsBaseline, threatBaseline, loading]);

    const handleSetBaseline = async (runId: string, type: 'url' | 'dns' | 'threat') => {
        try {
            await fetch('/api/security/scores/baseline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ runId, type })
            });
            fetchData();
        } catch (e) {
            console.error('Failed to set baseline', e);
        }
    };

    return {
        scores, loading,
        urlBaseline, dnsBaseline, threatBaseline,
        urlDiff, dnsDiff, threatDiff,
        handleSetBaseline
    };
};
