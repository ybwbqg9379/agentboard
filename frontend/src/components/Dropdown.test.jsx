// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Dropdown from './Dropdown.jsx';

describe('Dropdown', () => {
  const options = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' },
    { value: 'three', label: 'Three' },
  ];

  it('supports keyboard navigation, selection, and focus restoration', async () => {
    const onChange = vi.fn();

    render(
      <Dropdown ariaLabel="Number picker" options={options} value="one" onChange={onChange} />,
    );

    const trigger = screen.getByRole('button', { name: 'Number picker' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    expect(screen.getByRole('listbox', { name: 'Number picker' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Two' })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole('option', { name: 'Two' }), { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Three' })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole('option', { name: 'Three' }), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('three');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes with escape and returns focus to the trigger', async () => {
    render(
      <Dropdown ariaLabel="Palette picker" options={options} value="two" onChange={vi.fn()} />,
    );

    const trigger = screen.getByRole('button', { name: 'Palette picker' });

    fireEvent.keyDown(trigger, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Two' })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole('option', { name: 'Two' }), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
