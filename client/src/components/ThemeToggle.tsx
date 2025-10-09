import { useTheme } from '../context/ThemeContext';

type Props = {
  className?: string;
};

const ORDER: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];

export function ThemeToggle({ className = '' }: Props) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const cycleTheme = () => {
    const current = ORDER.indexOf(theme);
    const next = ORDER[(current + 1) % ORDER.length];
    setTheme(next);
  };

  const label =
    theme === 'system'
      ? `System (${resolvedTheme})`
      : resolvedTheme.charAt(0).toUpperCase() + resolvedTheme.slice(1);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={`flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-900 ${className}`}
      aria-label={`Switch color theme. Current: ${label}`}
      title={`Theme: ${label}`}
    >
      {resolvedTheme === 'dark' ? (
        <MoonIcon className="h-4 w-4" />
      ) : (
        <SunIcon className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M5.64 5.64l1.41 1.41" />
      <path d="M16.95 16.95l1.41 1.41" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.64 18.36l1.41-1.41" />
      <path d="M16.95 7.05l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 0 1 11.21 3 7 7 0 1 0 21 12.79z" />
    </svg>
  );
}
