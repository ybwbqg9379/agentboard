import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TerminalView from './TerminalView.jsx';
import ContextPanel from './ContextPanel.jsx';
import FileChangesPanel from './FileChangesPanel.jsx';
import styles from './RightPanel.module.css';

export default function RightPanel({ events, sessionStats }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('terminal');

  const tabs = useMemo(
    () => [
      { id: 'terminal', label: t('rightPanel.terminal') },
      { id: 'context', label: t('rightPanel.context') },
      { id: 'files', label: t('rightPanel.files') },
    ],
    [t],
  );

  return (
    <div className="panel">
      <div className={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {activeTab === 'terminal' && <TerminalView events={events} />}
        {activeTab === 'context' && <ContextPanel sessionStats={sessionStats} />}
        {activeTab === 'files' && <FileChangesPanel events={events} />}
      </div>
    </div>
  );
}
