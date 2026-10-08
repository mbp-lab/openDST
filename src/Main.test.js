import Main from './Main';
import {stopActiveFacecropCapture} from './facecropAdapter';

jest.mock('./facecropAdapter', () => ({stopActiveFacecropCapture: jest.fn()}));
jest.mock('./pages/StartPage', () => () => null);
jest.mock('./pages/Introduction', () => () => null);
jest.mock('./pages/MathTaskTutorial', () => () => null);
jest.mock('./pages/MathTask', () => () => null);
jest.mock('./pages/MathTaskResult', () => () => null);
jest.mock('./pages/SpeechTaskTutorial', () => () => null);
jest.mock('./pages/SpeechTask', () => () => null);
jest.mock('./pages/EndPage', () => () => null);
jest.mock('./components/StepperWithLabels', () => () => null);
jest.mock('./components/CancelDialog', () => () => null);

const originalLogging = process.env.REACT_APP_LOGGING;
const originalScrollTo = window.scrollTo;

function makeMain() {
    const main = new Main({});
    // Keep React's updater semantics while exercising Main's real tracker methods
    // without mounting the unrelated study UI.
    main.setState = update => {
        const next = typeof update === 'function' ? update(main.state, main.props) : update;
        main.state = {...main.state, ...next};
    };
    return main;
}

beforeEach(() => {
    stopActiveFacecropCapture.mockReset();
    process.env.REACT_APP_LOGGING = 'false';
    window.scrollTo = jest.fn();
});

afterEach(() => {
    if (originalLogging === undefined) delete process.env.REACT_APP_LOGGING;
    else process.env.REACT_APP_LOGGING = originalLogging;
    window.scrollTo = originalScrollTo;
});

test.each([
    ['math', main => main.endMathTask(12), 'mathTask_end'],
    ['speech', main => main.endSpeechTask(), 'speechTask_end']
])('waits for facecrop stop to settle before navigating away from the %s task', async (_task, finishTask, endTimeKey) => {
    const main = makeMain();
    let settleStop;
    stopActiveFacecropCapture.mockReturnValue(new Promise(resolve => { settleStop = resolve; }));
    const navigate = jest.spyOn(main, 'handleNext');

    const finishing = finishTask(main);
    expect(stopActiveFacecropCapture).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    settleStop({status: 'complete'});
    await finishing;
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(main.data.studyTimes[endTimeKey]).not.toBeNull();
});
