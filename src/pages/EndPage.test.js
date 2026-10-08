import React from 'react';
import {render, screen} from '@testing-library/react';
import EndPage from './EndPage';

jest.mock('@material-ui/core/Slide', () => ({children, in: isVisible}) => isVisible ? <>{children}</> : null);
jest.mock('@material-ui/core/Button', () => props => <button onClick={props.onClick}>{props.children}</button>);
jest.mock('@material-ui/core/CardContent', () => ({children}) => <div>{children}</div>);
jest.mock('@material-ui/core/Card', () => ({children}) => <div>{children}</div>);
jest.mock('@material-ui/core', () => ({CircularProgress: () => <div>loading</div>}));
jest.mock('i18next', () => ({t: key => key}));
jest.mock('../components/VisualAnalogueScale', () => () => null);
jest.mock('../components/Panas', () => () => null);
jest.mock('../components/CancelButton', () => ({CancelButton: () => null}));

function props(overrides = {}) {
    return {
        activeSlide: 'questionnaire',
        areAllVideosUploaded: true,
        failedVideoUploads: 0,
        studyMetaTracker: {studyTitle: 'Study', studyUuid: 'uuid', studyResultId: 'result'},
        speechTestAnalysis: {
            audioMeanQ1: 1, audioMeanQ2: 2, audioMeanQ3: 3,
            speakBreakCounterQ1: 0, speakBreakCounterQ2: 0, speakBreakCounterQ3: 0,
            speakingTickCounterQ1: 0, speakingTickCounterQ2: 0, speakingTickCounterQ3: 0,
            volumeHighQ1: 0, volumeHighQ2: 0, volumeHighQ3: 0
        },
        ...overrides
    };
}

const originalLogging = process.env.REACT_APP_LOGGING;
beforeEach(() => { process.env.REACT_APP_LOGGING = 'true'; });
afterEach(() => {
    if (originalLogging === undefined) delete process.env.REACT_APP_LOGGING;
    else process.env.REACT_APP_LOGGING = originalLogging;
});

test('moves from the waiting page to the success result after a pending facecrop artifact succeeds', () => {
    const view = render(<EndPage {...props({areAllVideosUploaded: false})} />);

    expect(screen.getByText('end.questionnaire.finish')).toBeTruthy();
    expect(screen.queryByText('end.questionnaire.all_data_saved')).toBeNull();
    expect(screen.queryByText('end.questionnaire.some_video_data_not_saved')).toBeNull();

    view.rerender(<EndPage {...props({areAllVideosUploaded: true})} />);
    expect(screen.getByText('end.questionnaire.all_data_saved')).toBeTruthy();
    expect(screen.queryByText('end.questionnaire.finish')).toBeNull();
});

test.each(['failed', 'uncertain'])('moves from the waiting page to the non-success result after a facecrop artifact settles %s', status => {
    const view = render(<EndPage {...props({areAllVideosUploaded: false})} />);
    expect(screen.getByText('end.questionnaire.finish')).toBeTruthy();

    // Main records both terminal statuses as a failed upload for the final page.
    view.rerender(<EndPage {...props({areAllVideosUploaded: true, failedVideoUploads: 1, lastStatus: status})} />);
    expect(screen.getByText('end.questionnaire.some_video_data_not_saved')).toBeTruthy();
    expect(screen.queryByText('end.questionnaire.all_data_saved')).toBeNull();
    expect(screen.queryByText('end.questionnaire.finish')).toBeNull();
});
