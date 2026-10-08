import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { CheckboxList } from './checkbox-list';

function Harness() {
  const [value, setValue] = useState<string[]>(['a']);
  return (
    <>
      <CheckboxList label="Üzvlər" options={[{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Bravo' }]} value={value} onChange={setValue} />
      <output>{value.join(',')}</output>
    </>
  );
}

describe('CheckboxList', () => {
  it('toggles values and filters by search', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(screen.getByRole('status')).toHaveTextContent('a,b');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alfa' }));
    expect(screen.getByRole('status')).toHaveTextContent('b');
    await userEvent.type(screen.getByRole('searchbox'), 'alf');
    expect(screen.queryByRole('checkbox', { name: 'Bravo' })).not.toBeInTheDocument();
  });
});
