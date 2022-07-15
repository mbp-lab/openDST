import React from 'react';
import i18next from "i18next";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";
import WebcamCapture from "../components/WebcamCapture";
import AssignmentIcon from '@material-ui/icons/Assignment';
import AudioAnalyser from "../components/AudioAnalyser";
import TrafficLightComponent from "../components/TrafficLightComponent";
import {CancelButton} from "../components/CancelButton";
import SpeechTaskCalibration from "../components/SpeechTaskCalibration";
import CountdownSpeechTask from "../components/CountdownSpeechTask";
import {calculateWidthInPx, calculateHeightInPx} from "../utils";

export default class SpeechTask extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            videoCounter: 1,
            webcamStream: null,
            hasUserMedia: false,

            speechTaskStates: [
                ["start", "dot-white", i18next.t('speechTask.header.start'), i18next.t('speechTask.question_0.header'),i18next.t('speechTask.question_0.question')],
                ["calibration", "dot-white", i18next.t('speechTask.header.calibration'), i18next.t('speechTask.question_0.header'),i18next.t('speechTask.feedback_0')],
                ["introTask1", "dot-white", i18next.t('speechTask.header.state_prepare'), i18next.t('speechTask.question_0.header'),i18next.t('speechTask.question_0.question')],
                ["runTask1", "dot-red", i18next.t('speechTask.header.state_run'), i18next.t('speechTask.question_0.header'), i18next.t('speechTask.feedback_0')],
                ["introTask2", "dot-white", i18next.t('speechTask.header.state_prepare'), i18next.t('speechTask.question_1.header'),i18next.t('speechTask.question_1.question')],
                ["runTask2", "dot-red", i18next.t('speechTask.header.state_run'), i18next.t('speechTask.question_1.header'), i18next.t('speechTask.feedback_0')],
                ["introTask3", "dot-white", i18next.t('speechTask.header.state_prepare'), i18next.t('speechTask.question_2.header'),i18next.t('speechTask.question_2.question')],
                ["runTask3", "dot-red", i18next.t('speechTask.header.state_run'), i18next.t('speechTask.question_2.header'), i18next.t('speechTask.feedback_0')]
            ],
            speechTaskStateCounter: 0,
            startMilliseconds: 10000,
            remainingMilliseconds: 10000,
            startTime: null,

            // for the first question
            speakingTickCounterQ1: 0,  // for ratio between speaking and not speaking
            speakBreakCounterQ1: 0,   // counter for all speak breaks
            audioMeanQ1: 0,           // mean volume
            volumeHighQ1: 0,          // a number which should store the biggest measurement of volume
            // for the second question
            speakingTickCounterQ2: 0,
            speakBreakCounterQ2: 0,
            audioMeanQ2: 0,
            volumeHighQ2: 0,
            // for the third question
            speakingTickCounterQ3: 0,
            speakBreakCounterQ3: 0,
            audioMeanQ3: 0,
            volumeHighQ3: 0,

            volume: 0,              // current volume
            signal_given: true,     // boolean storing whether a signal is given
        };

        this.webcamCallback = this.webcamCallback.bind(this);
        this.incrementSpeechTaskStateCounter = this.incrementSpeechTaskStateCounter.bind(this);

        this.audioWaveWidth = calculateWidthInPx(80);
        this.audioWaveHeight = calculateHeightInPx(15);

        this.intervalID = null;
        this.timeoutID = null;
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (prevState.speechTaskStateCounter !== this.state.speechTaskStateCounter ) {
            if (this.state.speechTaskStateCounter === 2){
                this.props.startSpeechTask()
                this.speechTaskEngine();
            }
        }
        if (prevProps.cancelDialogIsOpen !== this.props.cancelDialogIsOpen) {
            if (this.props.cancelDialogIsOpen) {
                clearInterval(this.intervalID);
                clearTimeout(this.timeoutID);
                this.setState({
                    hasUserMedia: false,
                    startMilliseconds: this.state.remainingMilliseconds
                });
                if (this.state.speechTaskStateCounter > 1) {
                    this.setState({
                        videoCounter: this.state.videoCounter + 1,
                    })
                }
            } else {
                if (this.state.speechTaskStateCounter > 1) {
                    this.speechTaskEngine();
                }
            }
        }
    }

    componentWillUnmount() {
        let data = {
            // for the first question
            speakingTickCounterQ1: this.state.speakingTickCounterQ1,  // for ratio between speaking and not speaking
            speakBreakCounterQ1: this.state.speakBreakCounterQ1,   // counter for all speak breaks
            audioMeanQ1: this.state.audioMeanQ1,           // mean volume
            volumeHighQ1: this.state.volumeHighQ1,          // a number which should store the biggest measurement of volume
            // for the second question
            speakingTickCounterQ2: this.state.speakingTickCounterQ2,
            speakBreakCounterQ2: this.state.speakBreakCounterQ2,
            audioMeanQ2: this.state.audioMeanQ2,
            volumeHighQ2: this.state.volumeHighQ2,
            // for the third question
            speakingTickCounterQ3: this.state.speakingTickCounterQ3,
            speakBreakCounterQ3: this.state.speakBreakCounterQ3,
            audioMeanQ3: this.state.audioMeanQ3,
            volumeHighQ3: this.state.volumeHighQ3,
        }
        this.props.speechTestAnalysisCallback(data);
    }

    speechTaskEngine() {
        this.setState(() => {
            return {
                startTime: Date.now(),
            }
        });
        this.intervalID = setInterval(() => {
            this.setState((state) => {
                return {remainingMilliseconds: state.startMilliseconds - (Date.now() - state.startTime)}
            })
        }, 1);
        if(["introTask1","introTask2","introTask3"].includes(this.state.speechTaskStates[this.state.speechTaskStateCounter][0])){
            this.timeoutID = setTimeout( () => {
                    clearInterval(this.intervalID)
                    this.setState({
                        startMilliseconds: 20000,
                        remainingMilliseconds: 20000,
                        speechTaskStateCounter: this.state.speechTaskStateCounter + 1,
                    })
                    this.speechTaskEngine();
                }, this.state.startMilliseconds);
        } else {
            this.timeoutID = setTimeout( () => {
                clearInterval(this.intervalID)
                if (this.state.speechTaskStateCounter === this.state.speechTaskStates.length - 1) {
                    this.props.endSpeechTask();
                } else {
                    this.setState({
                        startMilliseconds: 10000,
                        remainingMilliseconds: 10000,
                        speechTaskStateCounter: this.state.speechTaskStateCounter + 1,
                    }, () => this.speechTaskEngine())
                }

                }, this.state.startMilliseconds);
        }
    }

    incrementSpeechTaskStateCounter() {
        this.setState({
            speechTaskStateCounter: this.state.speechTaskStateCounter + 1
        })
    }

    webcamCallback(stream) {
        this.setState({
            webcamStream: stream,
            hasUserMedia: true,
        });
    }

    addSpeakPause = () => {
        this.setState((state) => {
            let currentState = this.state.speechTaskStates[this.state.speechTaskStateCounter][0];
            if (["runTask1"].includes(currentState)) {
                return {speakBreakCounterQ1: state.speakBreakCounterQ1 + 1};
            } else if (["runTask2"].includes(currentState)) {
                return {speakBreakCounterQ2: state.speakBreakCounterQ2 + 1};
            } else if (["runTask3"].includes(currentState)) {
                return {speakBreakCounterQ3: state.speakBreakCounterQ3 + 1};
            }
        });
    }

    addSpeakingTick = () => {
        this.setState((state) => {
            let currentState = this.state.speechTaskStates[this.state.speechTaskStateCounter][0];
            if (["runTask1"].includes(currentState)) {
                return {speakingTickCounterQ1: state.speakingTickCounterQ1 + 1};
            } else if (["runTask2"].includes(currentState)) {
                return {speakingTickCounterQ2: state.speakingTickCounterQ2 + 1};
            } else if (["runTask3"].includes(currentState)) {
                return {speakingTickCounterQ3: state.speakingTickCounterQ3 + 1};
            }
        });
    }

    setVolume(currentVolume) {
        let currentState = this.state.speechTaskStates[this.state.speechTaskStateCounter][0];

        // set current volume
        this.setState({volume: currentVolume})
        
        if (["runTask1"].includes(currentState)) {
            // we only want to adjust audioMean if a signal is given
            let allTicks = this.state.speakBreakCounterQ1 + this.state.speakingTickCounterQ1;
            if (currentVolume > 0) {
                this.setState({audioMeanQ1: (this.state.audioMeanQ1*allTicks + currentVolume) /(allTicks + 1)});
            }
        
            // set volume high
            if (this.state.volumeHighQ1 < currentVolume) {
                this.setState({volumeHighQ1: currentVolume});
            }
        } else if (["runTask2"].includes(currentState)) {
            // we only want to adjust audioMean if a signal is given
            let allTicks = this.state.speakBreakCounterQ2 + this.state.speakingTickCounterQ2;
            if (currentVolume > 0) {
                this.setState({audioMeanQ2: (this.state.audioMeanQ2*allTicks + currentVolume) /(allTicks + 1)});
            }
        
            // set volume high
            if (this.state.volumeHighQ2 < currentVolume) {
                this.setState({volumeHighQ2: currentVolume});
            }
        } else if (["runTask3"].includes(currentState)) {
            // we only want to adjust audioMean if a signal is given
            let allTicks = this.state.speakBreakCounterQ3 + this.state.speakingTickCounterQ3;
            if (currentVolume > 0) {
                this.setState({audioMeanQ3: (this.state.audioMeanQ3*allTicks + currentVolume) /(allTicks + 1)});
            }
        
            // set volume high
            if (this.state.volumeHighQ3 < currentVolume) {
                this.setState({volumeHighQ3: currentVolume});
            }
        }
    }
     
    setSignalGiven(signalGiven) {
        this.setState({signal_given: signalGiven});
    }

    render() {
        let background = null;
        let questionState = null;
        if (this.state.speechTaskStateCounter < 8) {
            switch (this.state.speechTaskStates[this.state.speechTaskStateCounter][0]) {
                case "introTask1":
                case "introTask2":
                case "introTask3":
                    background = "row speechTask-prepare";
                    questionState = "intro";
                    break;
                case "runTask1":
                case "runTask2":
                case "runTask3":
                    background = "row speechTask-speak";
                    questionState = "run";
                    break;
                default:
                    break;
            }
        }
        return (
            this.state.speechTaskStateCounter < 2
                ? <SpeechTaskCalibration
                    studyResultId={this.props.studyResultId}
                    markVideoAsUploading={this.props.markVideoAsUploading}
                    markVideoAsUploaded={this.props.markVideoAsUploaded}
                    handleCancelDialog={this.props.handleCancelDialog}
                    videoCounter={this.state.videoCounter}
                    speechTaskStates={this.state.speechTaskStates}
                    speechTaskStateCounter={this.state.speechTaskStateCounter}
                    signal_given={this.state.signal_given}
                    volume={this.state.volume}
                    speakBreakCallback = {this.addSpeakPause.bind(this)}
                    speakingTickCallback = {this.addSpeakingTick.bind(this)}
                    volumeCallback = {this.setVolume.bind(this)}
                    signalGivenCallback = {this.setSignalGiven.bind(this)}
                    incrementSpeechTaskStateCounter={this.incrementSpeechTaskStateCounter}
                />
                : <div>
                    <div className="container-fluid p-0">
                        <div className={background}>
                            <div className="col">
                                <div className="row justify-content-center py-2">
                                    <div className="col-10">
                                        <div className="speechTask-header-wait">
                                            {this.state.speechTaskStates[this.state.speechTaskStateCounter][2]}
                                        </div>
                                    </div>
                                </div>
                                {this.props.cancelDialogIsOpen
                                    ? <div/>
                                    : <div>
                                        <div className="row justify-content-center pb-2">
                                            <WebcamCapture
                                                studyPage='speechTask'
                                                markVideoAsUploading={this.props.markVideoAsUploading}
                                                markVideoAsUploaded={this.props.markVideoAsUploaded}
                                                studyResultId={this.props.studyResultId}
                                                videoCounter={this.state.videoCounter}
                                                webcamCallback={this.webcamCallback}
                                                webcamSize = {calculateHeightInPx(32)}
                                            />
                                        </div>
                                        {questionState === 'run'
                                            ? <div className="row justify-content-center">
                                                <TrafficLightComponent
                                                    calibration_mode={false}
                                                    signal_given={this.state.signal_given}
                                                    volume={this.state.volume}
                                                /></div>
                                            :<div/>}
                                    </div>
                                }
                                <div className="row justify-content-center">
                                    {questionState === 'run' && !this.props.cancelDialogIsOpen && this.state.hasUserMedia
                                        ? <AudioAnalyser
                                            state='recording'
                                            stream={this.state.webcamStream}
                                            height={this.audioWaveHeight}
                                            width={this.audioWaveWidth}
                                            stage={this.state.speechTaskStates[this.state.speechTaskStateCounter][0]}
                                            updateSpeechTaskFeedback={this.props.updateSpeechTaskFeedback}
                                            remainingMilliseconds={this.state.remainingMilliseconds}
                                            studyResultId={this.props.studyResultId}
                                            speakBreakCallback = {this.addSpeakPause.bind(this)}
                                            speakingTickCallback = {this.addSpeakingTick.bind(this)}
                                            volumeCallback = {this.setVolume.bind(this)}
                                            signalGivenCallback = {this.setSignalGiven.bind(this)}
                                        />
                                        : null
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="container-fluid p-0">
                        <div className="row justify-content-center py-2">
                            <div className="col-8 speechTask-countdown align-items-center">
                                <CountdownSpeechTask
                                    remainingMilliseconds={this.state.remainingMilliseconds}
                                    speechTaskStateCounter={this.state.speechTaskStateCounter}
                                />
                            </div>
                        </div>
                    </div>
                    {
                        this.state.speechTaskStateCounter > 1
                            ? <div className="container-fluid p-0">
                                <div className="row justify-content-center py-0 px-2">
                                    <Card>
                                        <CardContent className="py-0">
                                            <div className="row align-items-center border border-dark font-weight-bold">
                                                <div className="col-12 align-items-center p-0 ">
                                                    <AssignmentIcon style={{fontSize: 'medium'}}/>
                                                    <strong className="free-speech-tutorial-header">
                                                        {this.state.speechTaskStates[this.state.speechTaskStateCounter][3]}
                                                    </strong>
                                                </div>
                                            </div>
                                            <div className="speechTask-question">
                                                {this.state.speechTaskStates[this.state.speechTaskStateCounter][4]}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                            : <div/>
                    }
                    <div className="row justify-content-center align-items-center p-2">
                        <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                    </div>
                </div>
        )
    }
}
