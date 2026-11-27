import React, { useState } from 'react';
import { Lock, Mail, Moon, ShieldCheck, Sun, User as UserIcon } from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { BrandLogo } from './BrandLogo';

export function AuthGate() {
  const { login, register, loginWithGoogle, theme, toggleTheme } = useAshcloud();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      const msg = err?.message || 'Google sign-in could not be completed.';
      setError(msg);
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const busy = submitting || googleSubmitting;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0E14] text-[#111827] dark:text-[#F8FAFC] flex flex-col">
      <header className="w-full max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <BrandLogo variant="header" />
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-[#232B3B] bg-white dark:bg-[#131823] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#18202F] transition-colors whitespace-nowrap shrink-0"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-[#38BDF8]" /> : <Moon className="w-4 h-4 text-[#2563EB]" />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <BrandLogo variant="full" />
            <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 pt-1">
              One Cloud. Every File. Every Memory.
            </p>
          </div>

          <div className="bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] rounded-2xl p-6 sm:p-7 shadow-xl shadow-black/10 space-y-5">
            {/* Official Google Sign-In Button */}
            <div className="space-y-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full h-11 px-4 rounded-xl bg-white hover:bg-slate-50 text-[#1F1F1F] border border-[#747775]/40 font-medium text-sm flex items-center justify-center gap-3 shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{googleSubmitting ? 'Connecting Google Account...' : 'Sign in with Google'}</span>
              </button>
              <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
                Sign in securely to your ASHCLOUD workspace with Google.
              </p>
            </div>

            <div className="relative flex items-center py-0.5">
              <div className="flex-grow border-t border-slate-200 dark:border-[#232B3B]" />
              <span className="shrink mx-3 text-[11px] font-medium text-slate-400">or continue with email</span>
              <div className="flex-grow border-t border-slate-200 dark:border-[#232B3B]" />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0E14]">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#131823] text-[#111827] dark:text-[#F8FAFC] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#131823] text-[#111827] dark:text-[#F8FAFC] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B] focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B] focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B] focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In to ASHCLOUD' : 'Create Account'}
              </button>
            </form>

            <div className="pt-4 border-t border-slate-200 dark:border-[#232B3B] flex items-start gap-2.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
              <span>
                All images and files will be stored on this website permanently and will remain available even after signing out of an account.
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
