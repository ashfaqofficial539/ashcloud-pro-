import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Upload,
  Users,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { apiFetch } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import { BrandLogo } from './BrandLogo';

interface TopBarProps {
  onOpenMobileMenu: () => void;
  onQuickUpload: () => void;
}

export function TopBar({ onOpenMobileMenu, onQuickUpload }: TopBarProps) {
  const {
    user,
    demoAccounts,
    demoLogin,
    logout,
    theme,
    toggleTheme,
    activeNav,
    setActiveNav,
    globalSearchQuery,
    setGlobalSearchQuery,
    notifications,
    refreshNotifications,
  } = useAshcloud();

  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveNav('search');
  };

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  };

  const navTitleMap: Record<string, string> = {
    home: 'Home',
    photos: 'Photos',
    albums: 'Albums',
    drive: 'My Drive',
    vault: 'Hidden Vault',
    favorites: 'Favorites',
    recent: 'Recently Added',
    'shared-with-me': 'Shared With Me',
    'shared-by-me': 'Shared By Me',
    trash: 'Trash',
    storage: 'Storage Console',
    activity: 'Activity Log',
    settings: 'Settings',
    search: 'Search',
  };

  return (
    <header className="h-16 px-4 sm:px-6 bg-white/95 dark:bg-[#131823]/95 backdrop-blur border-b border-slate-200 dark:border-[#232B3B] flex items-center justify-between gap-3 sm:gap-4 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#18202F]"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="lg:hidden">
          <BrandLogo variant="compact" />
        </div>
        <span className="hidden lg:inline-block text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] whitespace-nowrap shrink-0">
          {navTitleMap[activeNav] || 'ASHCLOUD'}
        </span>
      </div>

      {/* Global Search */}
      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-xl">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={globalSearchQuery}
            onChange={(e) => {
              setGlobalSearchQuery(e.target.value);
              if (e.target.value.trim() && activeNav !== 'search') {
                setActiveNav('search');
              }
            }}
            onFocus={() => {
              if (globalSearchQuery.trim()) setActiveNav('search');
            }}
            placeholder="Search your photos, videos, albums, and drive..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B] text-[#111827] dark:text-[#F8FAFC] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB]"
          />
        </div>
      </form>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onQuickUpload}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Upload</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-xl border border-slate-200 dark:border-[#232B3B] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-[#38BDF8]" /> : <Moon className="w-4 h-4 text-[#2563EB]" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((o) => !o)}
            className="relative p-2 rounded-xl border border-slate-200 dark:border-[#232B3B] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2563EB] text-white font-mono text-[10px] font-semibold flex items-center justify-center tabular-nums">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] shadow-xl z-40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-[#232B3B] flex items-center justify-between">
                <span className="text-sm font-semibold">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="inline-flex items-center gap-1 text-xs text-[#2563EB] dark:text-[#38BDF8] hover:underline"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#232B3B]">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={async () => {
                        if (!n.isRead) {
                          await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                          await refreshNotifications();
                        }
                        if (n.type === 'share_invite' || n.type === 'share_revoked') {
                          setActiveNav('shared-with-me');
                        }
                        setNotifOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#18202F] transition-colors ${
                        !n.isRead ? 'bg-[#2563EB]/5 dark:bg-[#38BDF8]/5' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]">
                          {n.title}
                        </span>
                        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {n.message}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Account Menu */}
        <div className="relative" ref={accountRef}>
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-xl border border-slate-200 dark:border-[#232B3B] hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#2563EB] text-white text-xs font-semibold flex items-center justify-center">
                {user?.name?.slice(0, 1) || 'A'}
              </div>
            )}
            <span className="hidden md:inline text-xs font-medium max-w-[110px] truncate">
              {user?.name}
            </span>
          </button>

          {accountOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white dark:bg-[#131823] border border-slate-200 dark:border-[#232B3B] shadow-xl z-40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-[#232B3B]">
                <div className="text-sm font-semibold truncate">{user?.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
              </div>

              {demoAccounts.filter((a) => a.email !== user?.email).length > 0 && (
                <div className="p-2 border-b border-slate-200 dark:border-[#232B3B]">
                  <div className="px-2 py-1 text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                    <Users className="w-3 h-3" />
                    Switch Account
                  </div>
                  {demoAccounts
                    .filter((a) => a.email !== user?.email)
                    .map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={async () => {
                          setAccountOpen(false);
                          await demoLogin(acc.email);
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
                      >
                        <div className="w-6 h-6 rounded-full bg-[#2563EB]/15 text-[#2563EB] dark:text-[#38BDF8] text-xs font-semibold flex items-center justify-center shrink-0">
                          {acc.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{acc.name}</div>
                          <div className="text-[11px] text-slate-400 truncate">{acc.email}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}

              <div className="p-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    setActiveNav('settings');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-400" />
                  Account & Vault Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
