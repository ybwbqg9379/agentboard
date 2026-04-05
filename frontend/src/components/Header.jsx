import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Disc, History, Plus, Wifi, WifiOff } from 'lucide-react';
import Dropdown from './Dropdown';
import dropdownStyles from './Dropdown.module.css';
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
  onThemeChange,
  themePack,
  onThemePackChange,
  density,
  onDensityChange,
}) {
  const { t, i18n } = useTranslation();
  const langLabelId = useId();
  const themeModeLabelId = useId();
  const paletteLabelId = useId();
  const densityLabelId = useId();
  const mcpEntries = Object.entries(mcpHealth || {});
  const langValue = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en';
  const themeModeValue = theme === 'dark' ? 'dark' : 'light';

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

  const themeModeOptions = useMemo(
    () => [
      { value: 'light', label: t('header.themeLight') },
      { value: 'dark', label: t('header.themeDark') },
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
        <div className={styles.chromeCluster}>
          <div className={styles.themePackWrap}>
            <span id={langLabelId} className={styles.visuallyHidden}>
              {t('header.language')}
            </span>
            <Dropdown
              className={dropdownStyles.triggerFluid}
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
            <span id={themeModeLabelId} className={styles.visuallyHidden}>
              {t('header.themeModeTitle')}
            </span>
            <Dropdown
              className={dropdownStyles.triggerFluid}
              variant="compact"
              options={themeModeOptions}
              value={themeModeValue}
              onChange={onThemeChange}
              title={t('header.themeModeTitle')}
              ariaLabelledBy={themeModeLabelId}
            />
          </div>
          <div className={styles.themePackWrap}>
            <span id={paletteLabelId} className={styles.visuallyHidden}>
              {t('header.uiPalette')}
            </span>
            <Dropdown
              className={dropdownStyles.triggerFluid}
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
              className={dropdownStyles.triggerFluid}
              variant="compact"
              options={densityOptions}
              value={density}
              onChange={onDensityChange}
              title={t('header.densityTitle')}
              ariaLabelledBy={densityLabelId}
            />
          </div>
        </div>
        <div className={styles.trailingCluster}>
          <div className={styles.trailingLead}>
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
              <div className={styles.sessionActions}>
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
              </div>
            )}
          </div>
          <div
            className={styles.connStatus}
            role="status"
            aria-live="polite"
            aria-label={connected ? t('header.connected') : t('header.disconnected')}
            title={connected ? t('header.connected') : t('header.disconnected')}
          >
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
      </div>
    </header>
  );
}
