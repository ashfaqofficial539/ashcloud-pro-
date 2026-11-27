import React from 'react';

export const ASHCLOUD_LOGO_SRC = '/assets/aistudio/image-removebg-preview__10__da05e136.png';

interface BrandLogoProps {
  compact?: boolean;
  variant?: 'full' | 'header' | 'compact';
  showTagline?: boolean;
  className?: string;
}

export function BrandLogo({
  compact = false,
  variant,
  showTagline = false,
  className = '',
}: BrandLogoProps) {
  const mode = variant ?? (compact ? 'compact' : 'header');

  const imgHeightClass =
    mode === 'full' ? 'h-14 sm:h-16' : mode === 'compact' ? 'h-7' : 'h-9';
  const badgePaddingClass =
    mode === 'full'
      ? 'px-4 py-2 rounded-2xl'
      : mode === 'compact'
      ? 'p-1.5 rounded-xl'
      : 'px-2.5 py-1 rounded-xl';

  return (
    <div className={`inline-flex flex-col items-start select-none shrink-0 ${className}`}>
      <div
        className={`inline-flex items-center justify-center bg-[#F8FAFC] dark:bg-[#F8FAFC] border border-slate-200/80 dark:border-white/15 shadow-sm ${badgePaddingClass}`}
      >
        <img
          src={ASHCLOUD_LOGO_SRC}
          alt="ASHCLOUD"
          className={`${imgHeightClass} w-auto object-contain block`}
          draggable={false}
        />
      </div>
      {showTagline && !compact && mode !== 'compact' && (
        <span className="mt-2 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
          One Cloud. Every File. Every Memory.
        </span>
      )}
    </div>
  );
}
