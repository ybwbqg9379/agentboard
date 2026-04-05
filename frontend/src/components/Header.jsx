import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Disc, History, Moon, Plus, Sun, Wifi, WifiOff } from 'lucide-react';
import Dropdown from './Dropdown';
import styles from './Header.module.css';

const MCP_STATE_COLORS = {
  connected: 'var(--status-running)',
  degraded: 'var(--status-thinking)',
  failed: 'var(--status-error)',
  pending: 'var(--text-tertiary)',
  needs_auth: 'var(--status-thinking)',
};

export default function Header({
  connected,
  sessionId,
  onClear,
  onOpenHistory,
  mcpHealth,
  mode,
  onModeChange,
  theme,
  onToggleTheme,
  themePack,
  onThemePackChange,
  density,
  onDensityChange,
}) {
  const { t, i18n } = useTranslation();
  const langLabelId = useId();
  const paletteLabelId = useId();
  const densityLabelId = useId();
  const mcpEntries = Object.entries(mcpHealth || {});
  const themeLabel = theme === 'dark' ? t('header.themeDark') : t('header.themeLight');
  const langValue = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en';

  const langOptions = useMemo(
    () => [
      { value: 'en', label: t('header.langEnglish') },
      { value: 'zh-CN', label: t('header.langZhCN') },
    ],
    [t],
  );
  const themePackOptions = useMemo(
    () => [
      { value: 'default', label: t('header.paletteDefault') },
      { value: 'linear', label: t('header.paletteLinear') },
      { value: 'vercel', label: t('header.paletteVercel') },
      { value: 'cursor', label: t('header.paletteCursor') },
      { value: 'warp', label: t('header.paletteWarp') },
      { value: 'apple', label: t('header.paletteApple') },
    ],
    [t],
  );

  const densityOptions = useMemo(
    () => [
      { value: 'comfortable', label: t('header.densityComfortable') },
      { value: 'compact', label: t('header.densityCompact') },
    ],
    [t],
  );

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>{t('header.logo')}</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${mode === 'agent' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('agent')}
          >
            {t('header.modeAgent')}
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'workflow' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('workflow')}
          >
            {t('header.modeWorkflow')}
          </button>
          <button
            className={`${styles.modeTab} ${mode === 'experiment' ? styles.modeActive : ''}`}
            onClick={() => onModeChange('experiment')}
          >
            {t('header.modeExperiment')}
          </button>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.themePackWrap}>
          <span id={langLabelId} className={styles.visuallyHidden}>
            {t('header.language')}
          </span>
          <Dropdown
            variant="compact"
            options={langOptions}
            value={langValue}
            onChange={(v) => {
              void i18n.changeLanguage(v);
            }}
            title={t('header.language')}
            ariaLabelledBy={langLabelId}
          />
        </div>
        <div className={styles.themePackWrap}>
          <span id={paletteLabelId} className={styles.visuallyHidden}>
            {t('header.uiPalette')}
          </span>
          <Dropdown
            variant="compact"
            options={themePackOptions}
            value={themePack}
            onChange={onThemePackChange}
            title={t('header.uiPaletteTitle')}
            ariaLabelledBy={paletteLabelId}
          />
        </div>
        <div className={styles.themePackWrap}>
          <span id={densityLabelId} className={styles.visuallyHidden}>
            {t('header.density')}
          </span>
          <Dropdown
            variant="compact"
            options={densityOptions}
            value={density}
            onChange={onDensityChange}
            title={t('header.densityTitle')}
            ariaLabelledBy={densityLabelId}
          />
        </div>
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          title={t('header.themeTitle', { theme: themeLabel })}
          aria-label={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
        >
          {theme === 'dark' ? (
            <Sun size={14} strokeWidth={2} aria-hidden />
          ) : (
            <Moon size={14} strokeWidth={2} aria-hidden />
          )}
        </button>
        {mcpEntries.length > 0 && (
          <div className={styles.mcpHealth}>
            <span className={styles.mcpLabel}>{t('header.mcp')}</span>
            {mcpEntries.map(([name, info]) => (
              <Disc
                key={name}
                size={10}
                strokeWidth={0}
                className={styles.mcpGlyph}
                fill={MCP_STATE_COLORS[info.state] || MCP_STATE_COLORS.pending}
                title={t('header.mcpTooltip', {
                  name,
                  state: info.state,
                  calls: info.toolCalls,
                  errors: info.toolErrors,
                })}
                aria-hidden
              />
            ))}
          </div>
        )}
        {mode === 'agent' && (
          <>
            <button type="button" className={styles.historyBtn} onClick={onOpenHistory}>
              <History size={14} strokeWidth={2} className={styles.headerBtnIcon} aria-hidden />
              {t('header.history')}
            </button>
            {sessionId && (
              <button type="button" className={styles.clearBtn} onClick={onClear}>
                <Plus size={14} strokeWidth={2} className={styles.headerBtnIcon} aria-hidden />
                {t('header.newSession')}
              </button>
            )}
          </>
        )}
        <div className={styles.connStatus}>
          {connected ? (
            <Wifi size={14} strokeWidth={2} className={styles.connIcon} aria-hidden />
          ) : (
            <WifiOff size={14} strokeWidth={2} className={styles.connIconMuted} aria-hidden />
          )}
          <span className={styles.connText}>
            {connected ? t('header.connected') : t('header.disconnected')}
          </span>
        </div>
      </div>
    </header>
  );
}
