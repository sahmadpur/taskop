import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { COMMIT_DELAY_MS, CommitInput } from './commit-input';

describe('CommitInput', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('commits once, 500 ms after typing stops', async () => {
    const onCommit = jest.fn();
    await render(<CommitInput accessibilityLabel="Qeyd" value="" onCommit={onCommit} />);
    const input = screen.getByLabelText('Qeyd');
    await fireEvent.changeText(input, 'a');
    await act(async () => jest.advanceTimersByTime(COMMIT_DELAY_MS - 1));
    await fireEvent.changeText(input, 'ab');
    await act(async () => jest.advanceTimersByTime(COMMIT_DELAY_MS - 1));
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ab');
  });

  it('commits at once on blur and does not commit the same text again', async () => {
    const onCommit = jest.fn();
    await render(<CommitInput accessibilityLabel="Qeyd" value="" onCommit={onCommit} />);
    await fireEvent.changeText(screen.getByLabelText('Qeyd'), 'abc');
    await fireEvent(screen.getByLabelText('Qeyd'), 'blur');
    expect(onCommit).toHaveBeenCalledWith('abc');
    await act(async () => jest.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits unsaved text when it unmounts, so no keystroke is lost', async () => {
    const onCommit = jest.fn();
    const r = await render(<CommitInput accessibilityLabel="Qeyd" value="" onCommit={onCommit} />);
    await fireEvent.changeText(screen.getByLabelText('Qeyd'), 'son söz');
    await r.unmount();
    expect(onCommit).toHaveBeenCalledWith('son söz');
    await act(async () => jest.advanceTimersByTime(COMMIT_DELAY_MS));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
