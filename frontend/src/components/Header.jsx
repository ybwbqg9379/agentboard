import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
}) {
  const { t, i18n } = useTranslation();
  const langLabelId = useId();
  const paletteLabelId = useId();
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
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          title={t('header.themeTitle', { theme: themeLabel })}
          aria-label={theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark')}
        >
          {theme === 'dark' ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4"></circle>
              <path d="M12 2v2"></path>
              <path d="M12 20v2"></path>
              <path d="m4.93 4.93 1.41 1.41"></path>
              <path d="m17.66 17.66 1.41 1.41"></path>
              <path d="M2 12h2"></path>
              <path d="M20 12h2"></path>
              <path d="m6.34 17.66-1.41 1.41"></path>
              <path d="m19.07 4.93-1.41 1.41"></path>
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
            </svg>
          )}
        </button>
        {mcpEntries.length > 0 && (
          <div className={styles.mcpHealth}>
            <span className={styles.mcpLabel}>{t('header.mcp')}</span>
            {mcpEntries.map(([name, info]) => (
              <span
                key={name}
                className={styles.mcpDot}
                style={{ background: MCP_STATE_COLORS[info.state] || MCP_STATE_COLORS.pending }}
                title={t('header.mcpTooltip', {
                  name,
                  state: info.state,
                  calls: info.toolCalls,
                  errors: info.toolErrors,
                })}
              />
            ))}
          </div>
        )}
        {mode === 'agent' && (
          <>
            <button className={styles.historyBtn} onClick={onOpenHistory}>
              {t('header.history')}
            </button>
            {sessionId && (
              <button className={styles.clearBtn} onClick={onClear}>
                {t('header.newSession')}
              </button>
            )}
          </>
        )}
        <div className={styles.connStatus}>
          <span className={styles.connDot} data-connected={connected} />
          <span className={styles.connText}>
            {connected ? t('header.connected') : t('header.disconnected')}
          </span>
        </div>
      </div>
    </header>
  );
}
