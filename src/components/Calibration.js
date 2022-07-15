import i18next from "i18next";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";
import NotificationImportantIcon from "@material-ui/icons/NotificationImportant";
import Skeleton from "@material-ui/lab/Skeleton";
import VideocamIcon from "@material-ui/icons/Videocam";
import AudioAnalyser from "./AudioAnalyser";
import Button from "@material-ui/core/Button";
import VideoForm from "./VideoForm";
import React from "react";
import WebcamCapture from "./WebcamCapture";
import {calculateHeightInPx, calculateWidthInPx} from "../utils";


export default class Calibration extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasUserMedia: false,

            videoFeedbackState: 'permission',
            videoFeedback: {
                startRecord: i18next.t('mediaTesting.header.header_3'),
                stopRecord: i18next.t('mediaTesting.header.header_4'),
                waitRecord: i18next.t('mediaTesting.header.header_5'),
                permission: i18next.t('mediaTesting.header.header_1')
            },

            objectVideoURL: null,
            webcamStream: null,

            buttonStartRecord: true,
            calibrationState: "info",

            watchedVideo: false,
            mimeType: null,
        };
        this.recordedChunks = [];
        this.videoRef = React.createRef();

        this.setVideoURL = this.setVideoURL.bind(this);
        this.webcamCallback = this.webcamCallback.bind(this);
        this.checkFormAndContinue = this.checkFormAndContinue.bind(this);
    }

    setVideoURL(blob) {
        this.setState({
            objectVideoURL: URL.createObjectURL(blob),
        })
    }

    checkFormAndContinue(videoValue, faceValue) {
        if(videoValue === "true" && faceValue === "true"){
            this.props.handleNext()
        } else {
            this.setState({
                calibrationState: 'info',
                watchedVideo: false,
                videoFeedbackState: 'permission',
                buttonStartRecord: true,
                hasUserMedia: false
            })
            this.recordedChunks = [];
        }
    }

    webcamCallback(stream) {
        this.setState({
            webcamStream: stream,
            hasUserMedia: true,
        });
    }

    render() {
        const webcamHeight = calculateHeightInPx(33);
        const webcamWidth = calculateWidthInPx(80);

        let videoIntro = {
            header: <u> {i18next.t('mediaTesting.header.header_0')} </u>,
            listItem:
                [
                    i18next.t('mediaTesting.text0'),
                    i18next.t('mediaTesting.text1'),
                    i18next.t('mediaTesting.text2'),
                    i18next.t('mediaTesting.text3'),
                    i18next.t('mediaTesting.reading_text')
                ]
        }
        switch (this.state.calibrationState) {
            case "info":
                return(<>
                        <Card>
                            <div className="row">
                                <div className="col-12 p-0">
                                    <h3 className="index-body-header py-2">
                                        {videoIntro.header}
                                    </h3>
                                </div>
                            </div>
                            <CardContent className="py-0">
                                <ul className="list-styled ul stepper-bullet-point">
                                    <li className="pb-1">{videoIntro.listItem[0]}</li>
                                    <li className="pb-1">{videoIntro.listItem[1]}</li>
                                    <li className="pb-1">{videoIntro.listItem[2]}</li>
                                </ul>
                            </CardContent>
                        </Card>
                        <div className="row align-items-end mt-2">
                            <div className="justify-content-center col-12">
                                <Button
                                    variant="contained"
                                    className="alert-buttons"
                                    size="medium"
                                    onClick={() => {
                                        this.setState({
                                            calibrationState: "config",})}
                                    }>
                                    {i18next.t('button.continue')}
                                </Button>
                            </div>
                        </div>
                    </>
                )
            case "config":
                return(
                    <>
                        <div className="row my-2 justify-content-center">
                            <div className="col-12">
                                <Card>
                                    <div className="py-2 index-body-header">
                                        <NotificationImportantIcon fontSize={'large'}/>
                                        {this.state.videoFeedback[this.state.videoFeedbackState]}
                                    </div>
                                </Card>
                            </div>
                        </div>
                        <Skeleton variant="rect" animation={false} height={webcamHeight}/>
                        <div className="row justify-content-center mt-2">
                            <div className="p-2">
                                <Button
                                    variant="contained"
                                    className="alert-buttons"
                                    size="medium"
                                    onClick={() => {
                                        this.props.handleAbortDialog();
                                    }}>
                                    {i18next.t('button.disagree')}
                                </Button>
                            </div>
                            <div className="p-2">
                                <Button
                                    variant="contained"
                                    className="alert-buttons"
                                    size="medium"
                                    onClick={() => {
                                        this.setState({
                                            videoFeedbackState: 'waitRecord',
                                            calibrationState: 'record',
                                        })
                                    }}>
                                    {i18next.t('button.agree')}
                                </Button>
                            </div>
                        </div>
                    </>
                )
            case "record":
                let cameraCircle;
                if (this.state.videoFeedbackState === 'waitRecord' || this.state.videoFeedbackState === 'stopRecord') {
                    cameraCircle = <span className="dot-white" />
                } else {
                    cameraCircle = <span className="dot-red" />
                }
                return (
                    <>
                        <div className="row p-2 justify-content-center">
                            <div className="col-12">
                                <Card>
                                    <div className="py-2 index-body-header">
                                        <VideocamIcon fontSize={'large'}/>
                                        {cameraCircle}
                                        {this.state.videoFeedback[this.state.videoFeedbackState]}
                                    </div>
                                </Card>
                            </div>
                        </div>
                        <div className="row">
                            <div className="col-12">
                                <div className="row justify-content-center">
                                    <WebcamCapture
                                        studyPage='introduction'
                                        handleNext={this.props.handleNext}
                                        markVideoAsUploading={this.props.markVideoAsUploading}
                                        markVideoAsUploaded={this.props.markVideoAsUploaded}
                                        studyResultId={this.props.studyResultId}
                                        videoCounter={1}
                                        handleAbortDialog={this.handleAbortDialog}
                                        setVideoURL={this.setVideoURL}
                                        webcamCallback={this.webcamCallback}
                                        videoFeedbackState={this.state.videoFeedbackState}
                                        webcamSize={calculateHeightInPx(27)}
                                    />
                                </div>
                                {this.state.hasUserMedia
                                    ? <AudioAnalyser
                                        state='testing'
                                        stream={this.state.webcamStream}
                                        height={calculateHeightInPx(15)}
                                        width={calculateWidthInPx(70)}
                                    />
                                    : <div/>
                                }
                                <div className="row justify-content-center">
                                    <div className="col-12 visual-analog-scale">
                                        <div className="mediaTestingQuestion ">{videoIntro.listItem[3]}</div>
                                        <div className="mediaTestingQuestion font-weight-bold">"{videoIntro.listItem[4]}"
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="row align-items-end mt-2">
                            <div className="col-12 justify-content-center py-2">
                                {this.state.buttonStartRecord ?
                                    <Button
                                        className={"alert-buttons"}
                                        size="medium"
                                        onClick={() => {
                                            if (this.state.hasUserMedia) {
                                                this.setState({
                                                    videoFeedbackState: 'startRecord',
                                                    buttonStartRecord: false
                                                })
                                            } else {
                                                window.alert("Please give permissions for camera and microphone before continuing");
                                            }
                                        }}
                                    >
                                        {i18next.t('mediaTesting.start_record')}
                                    </Button>
                                    :
                                    <Button
                                        className={"alert-buttons"}
                                        size="medium"
                                        onClick={() => {
                                            this.setState({
                                                videoFeedbackState: 'stopRecord',
                                            }, () => this.setState({
                                                buttonStartRecord: true,
                                                calibrationState: "review"
                                            }))
                                        }}
                                    >
                                        {i18next.t('mediaTesting.stop_record')}
                                    </Button>
                                }
                            </div>
                        </div>
                    </>
                )
            case "review":
                return (
                    <>
                        <div className="row p-2 justify-content-center">
                            <div className="col-12">
                                <Card>
                                    <div className="py-2 index-body-header">
                                        {this.state.videoFeedback[this.state.videoFeedbackState]}
                                    </div>
                                </Card>
                            </div>
                        </div>
                        <div className="row justify-content-center">
                            <video
                                ref={this.videoRef}
                                height={webcamHeight}
                                width={webcamWidth}
                                autoPlay={true}
                                playsInline
                            />
                        </div>
                        {
                            this.state.watchedVideo === true
                                ? <div className="row pt-2">
                                    <VideoForm checkFormAndContinue={this.checkFormAndContinue}/>
                                </div>
                                : <div className="row align-items-end mt-2">
                                    <div className="col-12">
                                        <Button
                                            className="alert-buttons"
                                            size="medium"
                                            onClick={() => {
                                                this.videoRef.current.controls = true;
                                                this.videoRef.current.src = this.state.objectVideoURL;
                                                this.videoRef.current.type = this.state.mimeType;
                                                this.setState({watchedVideo:true})
                                            }}
                                        >
                                            {i18next.t('mediaTesting.play')}
                                        </Button>
                                    </div>
                                </div>
                        }
                    </>
                )
            default: break;
        }
    }
}