import { useState } from 'react';
import TerminalView from './TerminalView.jsx';
import ContextPanel from './ContextPanel.jsx';
import FileChangesPanel from './FileChangesPanel.jsx';
import styles from './RightPanel.module.css';

const TABS = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'context', label: 'Context' },
  { id: 'files', label: 'Files' },
];

export default function RightPanel({ events, sessionStats }) {
  const [activeTab, setActiveTab] = useState('terminal');

  return (
    <div className="panel">
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
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
