import React from 'react';
import Webcam from "react-webcam";
import {startFaceCropCaptureSession, stopFaceCropCaptureSession} from '../faceCrop/FaceCropCapture';

// Put variables in global scope to make them available to the browser console.
const constraints = window.constraints = {
    audio: true,
    video: true,
    facingMode: "user"
};

class WebcamCapture extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            timeoutID: null,
            mimeType: null,
        };
        this.recordedChunks = [];
        this.mediaStreamRecorder = null;
        this.webcamRef = React.createRef();
        this.faceCropController = null;

        this.startRecording = this.startRecording.bind(this);
        this.stopRecording = this.stopRecording.bind(this);
    }

    /**
     * For mathTask and speechTask the recording should only stop on unmounting.
     */
    componentWillUnmount() {
        if(this.props.studyPage === 'mathTask' || this.props.studyPage === 'speechTask' ) {
            this.stopRecording();
        }
    }

    /**
     * When this component is used in mathTask or speechTask then the this.startRecording() method is invoked on the event of
     * the webcam component getting userMedia. But for the Introduction component the recording should only start, when
     * the this.props.videoFeedbackState-variable changes to startRecord. Similar it should stop when this.props.videoFeedbackState
     * changes to stopRecord
     * @param prevProps
     * @param prevState
     * @param snapshot
     */
    componentDidUpdate(prevProps, prevState, snapshot) {
        if (this.props.studyPage === "introduction") {
            if ((prevProps.videoFeedbackState === "waitRecord" || prevProps.videoFeedbackState === "stopRecord") && this.props.videoFeedbackState === "startRecord") {
                this.startRecording();
            }
            if (prevProps.videoFeedbackState === "startRecord" && this.props.videoFeedbackState === "stopRecord") {
                this.stopRecording();
            }
        }
    }

    /**
     * Function that wraps the createMediaRecorderWithOptions function for different options.
     * @param stream a MediaStream object
     * @returns {Promise<void>}
     */
    async createMediaRecorder(stream) {
        let options = {
            mimeType: 'video/mp4',
            audioBitsPerSecond : 200000,
            videoBitsPerSecond : 500000
        };
        try {
            await this.createMediaRecorderWithOptions(stream, options)
        } catch (e0) {
            try {
                let options = {
                    mimeType: 'video/webm',
                    audioBitsPerSecond : 200000,
                    videoBitsPerSecond : 500000
                };
                await this.createMediaRecorderWithOptions(stream, options)
            } catch (e1) {
                throw e1;
            }
        }
    }

    /**
     * Function to initialise a MediaRecorder object with particular options for configuration and pass
     * event handler functions to it.
     * @param stream a MediaStream object
     * @param options object that configures mimeType, audioBitsPerSecond and videoBitsPerSecond
     * @returns {Promise<void>}
     */
    async createMediaRecorderWithOptions(stream, options) {
        this.mediaStreamRecorder = await new MediaRecorder(stream, options);
        this.mediaStreamRecorder.ondataavailable = event => {
            this.recordedChunks.push(event.data);
        }
        // Upload is triggered from MediaRecorder.onstop so every stop path
        // (manual, timeout, unmount) uses the same finalization behavior.
        this.mediaStreamRecorder.onstop = event => {
            this.uploadVideo();
        }
        this.mediaStreamRecorder.onerror = event => console.log(event);
        this.setState({
            mimeType: this.mediaStreamRecorder.mimeType
        })
    }

    /**
     * Creates a MediaRecorder object and starts the recording.
     * @returns {Promise<void>}
     */
    async startRecording() {
        try {
            await this.createMediaRecorder(this.webcamRef.current.stream);
            this.faceCropController = startFaceCropCaptureSession({webcam: this.webcamRef.current, props: this.props});
            await this.mediaStreamRecorder.start();
            if (this.props.studyPage === 'introduction') {
                this.setState({
                    timeoutID: setTimeout(() => this.stopRecording(), 30000)
                })
            }
        } catch (err) {
            console.log(err);
            window.alert(err)
        }
    }

    /**
     * Uploads a video to the JATOS backend. If this component is used in the Introduction component then a URL representing
     * the recorded video is passed back to the Introduction component for displaying it in a video-tag.
     */
    uploadVideo() {
        let blob = new Blob(this.recordedChunks, {type:this.state.mimeType});
        if (this.props.studyPage === 'introduction') {
            clearTimeout(this.state.timeoutID);
            this.props.setVideoURL(blob);
        }
        //Persisting
        if (process.env.NODE_ENV !== 'development' && process.env.REACT_APP_VIDEO_RECORDING === 'true' && process.env.REACT_APP_LOGGING === 'true') {
            let uploadId = this.props.markVideoAsUploading();
            let fileExtension = this.state.mimeType === 'video/mp4' ? '.mp4' : '.webm';
            jatos.uploadResultFile(blob, this.props.studyResultId + '_' + this.props.studyPage + '_' + this.props.videoCounter + fileExtension)//eslint-disable-line no-undef
                // Mark success only on resolved upload; do not mark success after a failed attempt.
                .then(() => this.props.markVideoAsUploaded(uploadId))
                .catch((error) => {
                    console.log(error);
                    this.props.markVideoAsFailed(uploadId);
                });
        }
    }

    async stopRecording() {
        // Stop both pipelines together: recorder stop triggers MP4/WebM upload,
        // and face-crop stop flushes worker/sink state before teardown completes.
        const patchStop = stopFaceCropCaptureSession(this.faceCropController);
        this.faceCropController = null;
        if (this.mediaStreamRecorder) {
            await this.mediaStreamRecorder.stop();
        }
        await patchStop;
    }

    render() {
        let borderVariable;
        switch (this.props.studyPage) {
            case 'mathTask':
                borderVariable = "border border-danger border-frame-red";
                break;
            default:
                borderVariable = '';
                break;
        }

        return (
            <Webcam
                audio={true}
                height={this.props.webcamSize}
                videoConstraints={constraints}
                className={borderVariable}
                ref={this.webcamRef}
                onUserMedia={() => {
                    if (this.props.studyPage === "introduction" || this.props.studyPage === 'speechTask') {
                        this.props.webcamCallback(this.webcamRef.current.stream);
                    }
                    if (this.props.studyPage === "mathTask" || this.props.studyPage === "speechTask") {
                        this.startRecording();
                    }
                }}
            />
        )
    }
}
export default WebcamCapture;
