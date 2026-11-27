import React from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderOpen,
  HardDrive,
  Heart,
  Home,
  Image as ImageIcon,
  Layers,
  Lock,
  Settings,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAshcloud } from '../context/AshcloudContext';
import { formatBytes } from '../lib/format';
import type { NavSection } from '../types';
import { BrandLogo } from './BrandLogo';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const PHOTOS_LIBRARY_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'favorites', label: 'Favorites', icon: Heart },
  { id: 'albums', label: 'Albums', icon: Layers },
  { id: 'shared-with-me', label: 'Shared With Me', icon: Users },
  { id: 'shared-by-me', label: 'Shared By Me', icon: Share2 },
  { id: 'recent', label: 'Recently Added', icon: Clock },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

const WORKSPACE_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'drive', label: 'My Drive', icon: FolderOpen },
  { id: 'vault', label: 'Hidden Vault', icon: Lock },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: SidebarProps) {
  const { activeNav, setActiveNav, storageSummary, sharesWithMe } = useAshcloud();

  const pendingInvitesCount = sharesWithMe.filter((s) => s.status === 'pending').length;
  const usedBytes = storageSummary?.userUsedBytes ?? 0;
  const targetBytes = storageSummary?.targetCapacityBytes ?? 512 * 1000 ** 4;
  const pctOfTarget = targetBytes > 0 ? Math.min(100, (usedBytes / targetBytes) * 100) : 0;

  const handleSelect = (id: NavSection) => {
    setActiveNav(id);
    onCloseMobile();
  };

  const renderGroup = (items: typeof PHOTOS_LIBRARY_ITEMS) => (
    <div className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeNav === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item.id)}
            title={collapsed ? item.label : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-[#2563EB]/15 text-[#2563EB] dark:bg-[#2563EB] dark:text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#18202F] hover:text-[#111827] dark:hover:text-white'
            } ${collapsed ? 'justify-center px-2' : ''}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
            {!collapsed && item.id === 'shared-with-me' && pendingInvitesCount > 0 && (
              <span
                className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${
                  active ? 'bg-white/20 text-white' : 'bg-[#2563EB]/15 text-[#2563EB] dark:text-[#38BDF8]'
                }`}
              >
                {pendingInvitesCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const sidebarContent = (
    <div className="h-full flex flex-col bg-white dark:bg-[#131823] border-r border-slate-200 dark:border-[#232B3B] select-none">
      <div
        className={`h-16 px-4 flex items-center border-b border-slate-200 dark:border-[#232B3B] ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        <button
          type="button"
          onClick={() => handleSelect('photos')}
          className="focus-visible:outline-none"
          aria-label="ASHCLOUD Photos"
        >
          <BrandLogo variant={collapsed ? 'compact' : 'header'} />
        </button>

        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#18202F] transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        <div>
          {!collapsed && (
            <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500">
              Photos Library
            </div>
          )}
          {renderGroup(PHOTOS_LIBRARY_ITEMS)}
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-[#232B3B]">
          {!collapsed && (
            <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500">
              ASHCLOUD Workspace
            </div>
          )}
          {renderGroup(WORKSPACE_ITEMS)}
        </div>
      </nav>

      {/* Storage summary card */}
      {!collapsed && (
        <div className="p-3.5 m-3 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0E14] border border-slate-200 dark:border-[#232B3B]">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-700 dark:text-slate-200">Storage Used</span>
            <span className="font-mono text-[11px] text-[#2563EB] dark:text-[#38BDF8] tabular-nums">
              {formatBytes(usedBytes)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-[#2563EB] rounded-full transition-all"
              style={{ width: `${Math.max(usedBytes > 0 ? 2 : 0, pctOfTarget)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            <span>512 TB Architecture</span>
            <button
              type="button"
              onClick={() => handleSelect('storage')}
              className="text-[#2563EB] dark:text-[#38BDF8] hover:underline font-medium"
            >
              Manage
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ${
          collapsed ? 'w-[76px]' : 'w-[252px]'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/70" onClick={onCloseMobile} />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
