import React from 'react';

export default function LedgeroLogo({ size = 32, rounded = true, className = '' }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 512 512" 
      width={size} 
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <defs>
        <linearGradient id="compLedgeroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="40%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      
      {rounded && (
        <rect width="512" height="512" rx="112" fill="#0B0F19" />
      )}

      <g>
        {/* Vertical Column */}
        <rect x="115" y="100" width="112" height="172" rx="10" fill="url(#compLedgeroGrad)" />
        
        {/* Middle Ledger Row */}
        <rect x="115" y="286" width="232" height="56" rx="10" fill="url(#compLedgeroGrad)" />
        
        {/* Bottom Ledger Row */}
        <rect x="115" y="356" width="288" height="56" rx="10" fill="url(#compLedgeroGrad)" />
      </g>
    </svg>
  );
}