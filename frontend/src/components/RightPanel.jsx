import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart2, FolderOpen, Terminal } from 'lucide-react';
import TerminalView from './TerminalView.jsx';
import ContextPanel from './ContextPanel.jsx';
import FileChangesPanel from './FileChangesPanel.jsx';
import styles from './RightPanel.module.css';

export default function RightPanel({ events, sessionStats }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('terminal');

  const tabs = useMemo(
    () => [
      { id: 'terminal', label: t('rightPanel.terminal'), Icon: Terminal },
      { id: 'context', label: t('rightPanel.context'), Icon: BarChart2 },
      { id: 'files', label: t('rightPanel.files'), Icon: FolderOpen },
    ],
    [t],
  );

  return (
    <div className="panel">
      <div className={styles.tabBar}>
        {tabs.map((tab) => {
          const TabIcon = tab.Icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <TabIcon size={14} strokeWidth={2} className={styles.tabIcon} aria-hidden />
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.content}>
        {activeTab === 'terminal' && <TerminalView events={events} />}
        {activeTab === 'context' && <ContextPanel sessionStats={sessionStats} />}
        {activeTab === 'files' && <FileChangesPanel events={events} />}
      </div>
    </div>
  );
}
