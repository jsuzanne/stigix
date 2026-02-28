import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface LoginProps {
    onLogin: (token: string, username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok) {
                onLogin(data.token, data.username);
            } else {
                setError(data.error || 'Login failed');
            }
        } catch (err) {
            setError('Connection failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full" />
            </div>

            <div className="bg-card/50 backdrop-blur-xl border border-border/50 p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl relative z-10">
                <div className="flex justify-center mb-8">
                    <div className="p-4 bg-blue-600/10 rounded-2xl text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-inner">
                        <Lock size={32} />
                    </div>
                </div>

                <div className="text-center mb-10">
                    <h1 className="text-3xl font-black text-text-primary tracking-tighter mb-2">Console Access</h1>
                    <div className="h-1 w-12 bg-blue-600 mx-auto rounded-full mb-4" />
                    <p className="text-[10px] font-black text-text-muted tracking-[0.2em] opacity-60">Network Traffic Generator</p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 px-5 py-3.5 rounded-2xl mb-8 text-[11px] font-black tracking-widest flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full bg-card-secondary/30 border border-border text-text-primary rounded-2xl px-5 py-3.5 text-[11px] font-black tracking-widest focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-inner placeholder:opacity-30"
                            placeholder="username..."
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-card-secondary/30 border border-border text-text-primary rounded-2xl px-5 py-3.5 text-[11px] font-black tracking-widest focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-inner placeholder:opacity-30"
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black tracking-[0.25em] py-4 rounded-2xl transition-all mt-4 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Authenticating...
                            </>
                        ) : 'Sign In'}
                    </button>
                </form>

                <div className="mt-10 pt-8 border-t border-border/50 text-center">
                    <p className="text-[9px] font-bold text-text-muted tracking-widest opacity-40">Version 1.1.2</p>
                </div>
            </div>
        </div>
    );
}
