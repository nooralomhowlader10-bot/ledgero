// AIAgentFloatingButton.jsx — Floating Launcher for NAM AI
import React from 'react';
import { Bot } from 'lucide-react';

export default function AIAgentFloatingButton({ onClick, lang = 'bn' }) {
  return (
    <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40 flex items-center gap-2">
      {/* Floating Action Button with prominent NAM AI Badge */}
      <button
        onClick={onClick}
        className="relative flex items-center gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-full bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 text-white shadow-2xl hover:shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-all duration-200 border-2 border-white/30 cursor-pointer focus:outline-none focus:ring-4 focus:ring-emerald-400/40 group"
        title="Open NAM AI (Alt + A)"
        aria-label="NAM AI Assistant"
      >
        {/* Subtle Ambient Pulse Ring */}
        <span className="absolute -inset-1 rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 opacity-50 blur-xs animate-pulse group-hover:opacity-80 transition-opacity" />
        
        {/* Icon with ping indicator */}
        <div className="relative flex items-center justify-center">
          <Bot className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
          </span>
        </div>

        {/* Text Label: NAM AI */}
        <div className="relative flex items-center gap-1.5 font-bold tracking-tight text-xs sm:text-sm">
          <span>NAM AI</span>
          <span className="hidden sm:inline-block text-xs bg-white/20 px-1.5 py-0.5 rounded text-emerald-100 font-mono">Alt+A</span>
        </div>
      </button>
    </div>
  );
}
