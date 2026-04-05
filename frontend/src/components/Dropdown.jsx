import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Dropdown.module.css';

export default function Dropdown({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
  title = '',
  direction = 'down', // 'up' or 'down'
  /** Header / toolbar: smaller mono; trigger width follows label (capped by parent) */
  variant = 'default',
  ariaLabel,
  ariaLabelledBy,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = useId();

  const selectedIndex = Math.max(
    options.findIndex((opt) => opt.value === value),
    0,
  );
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, options.length);
  }, [options.length]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(selectedIndex);
    }
  }, [isOpen, selectedIndex]);

  const focusIndex = (index) => {
    if (options.length === 0) return;
    const normalized = (index + options.length) % options.length;
    setActiveIndex(normalized);
  };

  const openMenu = (index = selectedIndex) => {
    if (disabled || options.length === 0) return;
    focusIndex(index);
    setIsOpen(true);
  };

  const closeMenu = ({ focusTrigger = false } = {}) => {
    setIsOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      closeMenu();
      return;
    }
    openMenu(selectedIndex);
  };

  const handleSelectedKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu(selectedIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(selectedIndex - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) {
        optionRefs.current[activeIndex]?.focus();
      } else {
        openMenu(selectedIndex);
      }
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      closeMenu();
    }
  };

  const handleSelect = (val, e) => {
    e.stopPropagation();
    onChange(val);
    closeMenu({ focusTrigger: true });
  };

  const handleOptionKeyDown = (index) => (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusIndex(index + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusIndex(index - 1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      focusIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      focusIndex(options.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange(options[index].value);
      closeMenu({ focusTrigger: true });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu({ focusTrigger: true });
      return;
    }
    if (e.key === 'Tab') {
      closeMenu();
    }
  };

  const handleBlur = (e) => {
    const nextFocus = e.relatedTarget;
    if (containerRef.current?.contains(nextFocus)) return;
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${variant === 'compact' ? styles.compact : ''} ${disabled ? styles.disabled : ''} ${className}`}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.selected} ${isOpen ? styles.open : ''}`}
        onClick={handleToggle}
        onKeyDown={handleSelectedKeyDown}
        title={title}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown className={styles.chevron} size={14} strokeWidth={2} aria-hidden />
      </button>

      {isOpen && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={`${styles.menu} ${direction === 'up' ? styles.menuUp : styles.menuDown}`}
        >
          {options.map((opt, index) => (
            <li
              key={opt.value}
              className={`${styles.option} ${opt.value === value ? styles.active : ''}`}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              tabIndex={index === activeIndex ? 0 : -1}
              aria-selected={opt.value === value}
              onKeyDown={handleOptionKeyDown(index)}
              onMouseEnter={() => setActiveIndex(index)}
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
