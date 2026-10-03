import React, { useState, useEffect } from 'react';
import { Lock, User, Eye, EyeOff, ShieldCheck, Activity, ArrowRight, Zap } from 'lucide-react';

interface LoginProps {
    onLogin: (token: string, username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [version, setVersion] = useState('2.0.143');

    useEffect(() => {
        fetch('/api/version')
            .then(res => res.json())
            .then(data => {
                if (data?.version) setVersion(data.version);
            })
            .catch(() => {});
    }, []);

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
                setError(data.error || 'Invalid credentials. Please check username and password.');
            }
        } catch (err) {
            setError('Unable to reach Stigix node. Check network connection.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#060913] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-blue-500/30 selection:text-blue-200">
            {/* High-Tech Background Mesh & Radial Gradients */}
            <div className="absolute inset-0 pointer-events-none">
                {/* Cyber Grid */}
                <div 
                    className="absolute inset-0 opacity-[0.07]" 
                    style={{ 
                        backgroundImage: `radial-gradient(circle at 1px 1px, #3b82f6 1px, transparent 0)`,
                        backgroundSize: '32px 32px' 
                    }} 
                />
                
                {/* Glowing Ambient Lights */}
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-[140px] animate-pulse" />
                <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: '2s' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-purple-600/5 rounded-full blur-[180px]" />
            </div>

            {/* Login Card Container */}
            <div className="w-full max-w-md relative z-10">
                <div className="bg-[#0b101e]/85 backdrop-blur-2xl border border-blue-500/20 p-8 sm:p-10 rounded-3xl shadow-[0_0_60px_rgba(15,23,42,0.8),0_0_30px_rgba(59,130,246,0.12)] relative overflow-hidden transition-all">
                    
                    {/* Top Accent Light Bar */}
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

                    {/* Logo & Header */}
                    <div className="flex flex-col items-center text-center mb-8">
                        {/* Glowing Logo Icon */}
                        <div className="relative mb-4 group cursor-default">
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-40 group-hover:opacity-75 transition duration-500" />
                            <div className="relative p-3.5 bg-[#0e1628] rounded-2xl border border-blue-500/30 text-blue-400 shadow-inner flex items-center justify-center">
                                <Activity size={28} className="animate-pulse text-blue-400" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 p-1 bg-emerald-500/20 border border-emerald-500/40 rounded-full text-emerald-400">
                                <Zap size={10} fill="currentColor" />
                            </div>
                        </div>

                        {/* Title & Badge */}
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 text-[9px] font-black tracking-widest uppercase mb-2 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                            Secure Node Console
                        </div>

                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-blue-200 bg-clip-text text-transparent">
                            STIGIX
                        </h1>
                        <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mt-1 opacity-75">
                            Advanced Networking & Security Environment
                        </p>
                    </div>

                    {/* Error Banner */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl mb-6 text-xs font-semibold flex items-center gap-3 animate-in fade-in slide-in-from-top-2 shadow-sm">
                            <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 animate-pulse" />
                            <span className="leading-tight">{error}</span>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Username */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 ml-1">
                                <User size={12} className="text-blue-400" />
                                Username
                            </label>
                            <div className="relative group">
                                <input
                                    type="text"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    className="w-full bg-[#121a2d]/80 border border-slate-700/70 text-slate-100 placeholder:text-slate-500 rounded-xl px-4 py-3 text-xs font-medium focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-inner hover:border-slate-600"
                                    placeholder="Enter node username"
                                    required
                                    autoComplete="username"
                                    autoCapitalize="none"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 ml-1">
                                <Lock size={12} className="text-blue-400" />
                                Password
                            </label>
                            <div className="relative group">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full bg-[#121a2d]/80 border border-slate-700/70 text-slate-100 placeholder:text-slate-500 rounded-xl pl-4 pr-11 py-3 text-xs font-medium focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-inner hover:border-slate-600 font-mono"
                                    placeholder="••••••••••••"
                                    required
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
                                    title={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-500 text-white text-[11px] font-black tracking-widest uppercase py-3.5 rounded-xl transition-all duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_25px_rgba(59,130,246,0.35)] hover:shadow-[0_0_35px_rgba(59,130,246,0.55)] flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] border border-blue-400/30"
                        >
                            {loading ? (
                                <>
                                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Authenticating...
                                </>
                            ) : (
                                <>
                                    Sign In <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer Info */}
                    <div className="mt-8 pt-6 border-t border-slate-800/80 flex flex-col items-center justify-center gap-2">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest opacity-80">
                            <ShieldCheck size={12} className="text-emerald-400" />
                            Zero-Trust Mesh Authentication
                        </div>
                        <p className="text-[9.5px] font-mono text-slate-400 tracking-wider">
                            Stigix Platform <span className="text-blue-400 font-bold">v{version}</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
