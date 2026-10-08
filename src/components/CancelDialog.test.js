import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import CancelDialog from './CancelDialog';
import {abortActiveFacecropCapture, stopActiveFacecropCapture} from '../facecropAdapter';

jest.mock('../facecropAdapter', () => ({
    abortActiveFacecropCapture: jest.fn(),
    stopActiveFacecropCapture: jest.fn()
}));
jest.mock('i18next', () => ({t: key => key}));
jest.mock('./Redirection', () => ({cancelValue}) => <div>redirect:{cancelValue}</div>);

const props = {
    cancelDialogIsOpen: true, areAllVideosUploaded: true,
    handleCancelDialog: jest.fn(), uploadFinalData: jest.fn(), studyMetaTracker: {}
};

beforeEach(() => {
    jest.useFakeTimers();
    abortActiveFacecropCapture.mockResolvedValue(null);
    stopActiveFacecropCapture.mockResolvedValue(null);
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
});

function confirm(choice) {
    fireEvent.click(screen.getByLabelText(`cancelDialog.${choice}`));
    fireEvent.click(screen.getByText('OK'));
}

async function advance(ms) {
    await act(async () => {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
    });
}

test('finalizes capture before redirect and waits for artifacts registered during stop', async () => {
    let finish;
    stopActiveFacecropCapture.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<CancelDialog {...props} />);
    confirm('cancel_with_video');
    expect(stopActiveFacecropCapture).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(screen.queryByText('redirect:cancel_with_video')).toBeNull();

    // Graceful stop can register the final partial part and manifest while draining.
    view.rerender(<CancelDialog {...props} areAllVideosUploaded={false} />);
    await act(async () => { finish({status: 'complete'}); });
    expect(screen.queryByText('redirect:cancel_with_video')).toBeNull();
    view.rerender(<CancelDialog {...props} />);
    expect(screen.getByText('redirect:cancel_with_video')).toBeTruthy();
});

test('aborts without-video capture but waits for already accepted uploads to settle', async () => {
    const view = render(<CancelDialog {...props} areAllVideosUploaded={false} />);
    confirm('cancel_no_video');
    await advance(500);
    expect(abortActiveFacecropCapture).toHaveBeenCalledTimes(1);
    expect(stopActiveFacecropCapture).not.toHaveBeenCalled();
    expect(screen.queryByText('redirect:cancel_no_video')).toBeNull();
    // A failed artifact is terminal too; it must release the wait.
    view.rerender(<CancelDialog {...props} />);
    expect(screen.getByText('redirect:cancel_no_video')).toBeTruthy();
});

test('aborts without-data capture before redirect without waiting for uploads', async () => {
    let finish;
    abortActiveFacecropCapture.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<CancelDialog {...props} areAllVideosUploaded={false} />);
    confirm('cancel_without_data');
    await advance(500);
    expect(screen.queryByText('redirect:cancel_without_data')).toBeNull();
    await act(async () => { finish({status: 'aborted'}); });
    expect(screen.getByText('redirect:cancel_without_data')).toBeTruthy();
});

test('preserves the three-minute redirect fallback when capture closure hangs', async () => {
    stopActiveFacecropCapture.mockReturnValue(new Promise(() => {}));
    render(<CancelDialog {...props} areAllVideosUploaded={false} />);
    confirm('cancel_with_video');
    await advance(179999);
    expect(screen.queryByText('redirect:cancel_with_video')).toBeNull();
    await advance(1);
    expect(screen.getByText('redirect:cancel_with_video')).toBeTruthy();
});

test('continuing the study leaves capture running', () => {
    render(<CancelDialog {...props} />);
    confirm('no_cancel');
    expect(props.handleCancelDialog).toHaveBeenCalledTimes(1);
    expect(stopActiveFacecropCapture).not.toHaveBeenCalled();
    expect(abortActiveFacecropCapture).not.toHaveBeenCalled();
});
