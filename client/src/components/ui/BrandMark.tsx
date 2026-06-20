import React, { useId } from 'react';

interface BrandMarkProps {
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = 'w-6 h-6' }) => {
  // Unique per instance so multiple BrandMarks in one document do not collide on
  // the gradient id (url(#id) otherwise resolves to the first match in the DOM).
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="OpenTriologue brand mark"
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${gradientId})`} />
      <path d="M18 18L46 18L32 46Z" fill="none" stroke="#94a3b8" strokeOpacity="0.75" strokeWidth="2.5" />
      <circle cx="18" cy="18" r="8" fill="#38bdf8" />
      <circle cx="46" cy="18" r="8" fill="#fb923c" />
      <circle cx="32" cy="46" r="10" fill="#22c55e" />
      <circle cx="32" cy="46" r="4" fill="#f8fafc" />
    </svg>
  );
};
