import React from 'react';

interface OfflineKitLogoProps {
  className?: string;
}

export const OfflineKitLogo: React.FC<OfflineKitLogoProps> = ({ className = 'w-8 h-8' }) => {
  return (
    <div
      className={`${className} rounded-xl bg-gradient-to-br from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-sm relative overflow-hidden shrink-0 border border-white/25`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-[62%] h-[62%]"
         stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="6" rx="7.5" ry="3" />
        <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
        <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3 1.75 0 3.36-.24 4.64-.65" />
        <circle cx="18.5" cy="17.5" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
};
