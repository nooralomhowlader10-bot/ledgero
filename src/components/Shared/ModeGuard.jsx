// ═══════════════════════════════════════════════════════════════════════
// ModeGuard — Declarative component for Easy/Advanced conditional render
// Usage: <ModeGuard mode="easy">...</ModeGuard>
//        <ModeGuard mode="advanced">...</ModeGuard>
// ═══════════════════════════════════════════════════════════════════════
import { useApp } from '../../context/AppContext';

/**
 * Conditionally renders children based on current app mode.
 * @param {'easy' | 'advanced'} mode - Which mode to show content in
 * @param {boolean} [feature] - Optional feature flag name to also check (Advanced only)
 */
export default function ModeGuard({ mode, feature, children }) {
  const { state } = useApp();
  const currentMode = state.appMode || 'easy';

  if (mode === 'easy' && currentMode === 'easy') return children;
  if (mode === 'advanced' && currentMode === 'advanced') {
    if (feature && !state.featureFlags?.[feature]) return null;
    return children;
  }
  return null;
}

/**
 * Hook for easy mode checks in component logic
 */
export function useAppMode() {
  const { state } = useApp();
  return {
    isEasy: (state.appMode || 'easy') === 'easy',
    isAdvanced: state.appMode === 'advanced',
    mode: state.appMode || 'easy',
    featureFlags: state.featureFlags || {},
    hasFeature: (name) => state.appMode === 'advanced' && !!state.featureFlags?.[name],
  };
}
