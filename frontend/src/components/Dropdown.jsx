import { useState, useRef, useEffect } from 'react';
import styles from './Dropdown.module.css';

export default function Dropdown({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
  title = '',
  direction = 'down', // 'up' or 'down'
  /** Matches header / toolbar selects: smaller, mono, max-width */
  variant = 'default',
  ariaLabel,
  ariaLabelledBy,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (!disabled) setIsOpen(!isOpen);
  };

  const handleSelectedKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen((open) => !open);
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleSelect = (val, e) => {
    e.stopPropagation();
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${variant === 'compact' ? styles.compact : ''} ${disabled ? styles.disabled : ''} ${className}`}
      title={title}
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className={`${styles.selected} ${isOpen ? styles.open : ''}`}
        onClick={handleToggle}
        onKeyDown={handleSelectedKeyDown}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span>{selectedOption?.label}</span>
        <svg
          className={styles.chevron}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>

      {isOpen && !disabled && (
        <ul className={`${styles.menu} ${direction === 'up' ? styles.menuUp : styles.menuDown}`}>
          {options.map((opt) => (
            <li
              key={opt.value}
              className={`${styles.option} ${opt.value === value ? styles.active : ''}`}
              onClick={(e) => handleSelect(opt.value, e)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
