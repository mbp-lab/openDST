import React from 'react';
import Webcam from "react-webcam";
import {prepareFaceCropCaptureSession, resolveStudyResultId, startFaceCropCaptureSession, stopFaceCropCaptureSession} from '../faceCrop/FaceCropStudyAdapter';

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
        this.unmounted = false;
        this.stopPromise = null;

        this.startRecording = this.startRecording.bind(this);
        this.stopRecording = this.stopRecording.bind(this);
    }

    /**
     * For mathTask and speechTask the recording should only stop on unmounting.
     */
    componentWillUnmount() {
        this.unmounted = true;
        const deferFaceCropStop = Boolean(this.props.faceCropCancellationState && this.props.faceCropCancellationState.current);
        if(this.props.studyPage === 'mathTask' || this.props.studyPage === 'speechTask' ) {
            this.stopRecording({deferFaceCropStop});
        } else if (this.faceCropController) {
            const faceCropSession = this.faceCropController;
            this.faceCropController = null;
            if (!deferFaceCropStop) {
                stopFaceCropCaptureSession(faceCropSession).finally(() => {
                    if (this.props.onFaceCropSessionFinished) this.props.onFaceCropSessionFinished(faceCropSession);
                });
            }
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
        this.mediaStreamRecorder.onstart = () => this.props.onVideoCaptureEvent && this.props.onVideoCaptureEvent({
            type: 'start', studyPage: this.props.studyPage, videoCounter: this.props.videoCounter
        });
        // Upload is triggered from MediaRecorder.onstop so every stop path
        // (manual, timeout, unmount) uses the same finalization behavior.
        this.mediaStreamRecorder.onstop = event => {
            if (this.props.onVideoCaptureEvent) this.props.onVideoCaptureEvent({
                type: 'stop', studyPage: this.props.studyPage, videoCounter: this.props.videoCounter
            });
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
        if (this.startPromise || this.unmounted) return this.startPromise;
        if (this.mediaStreamRecorder && this.mediaStreamRecorder.state !== 'inactive') return;
        this.startPromise = (async () => {
            if (this.stopPromise) await this.stopPromise;
            this.stopPromise = null;
            this.recorderStopPromise = null;
            this.recordingStopRequested = false;
            return this.startRecordingInternal();
        })();
        try {
            return await this.startPromise;
        } finally {
            this.startPromise = null;
        }
    }

    async startRecordingInternal() {
        try {
            if (this.stopPromise) {
                await this.stopPromise;
                this.stopPromise = null;
            }
            if (!this.webcamRef.current || !this.webcamRef.current.stream) return;
            await this.createMediaRecorder(this.webcamRef.current.stream);
            if (this.unmounted || this.recordingStopRequested) return;
            await this.mediaStreamRecorder.start();
            if (this.unmounted || this.recordingStopRequested) { await this.stopMediaRecorder(); return; }
            if (this.faceCropController) {
                this.faceCropController.start().catch(error => console.log(error));
            } else {
                this.faceCropController = startFaceCropCaptureSession({webcam: this.webcamRef.current, props: this.props});
                this.registerFaceCropSession(this.faceCropController);
            }
            if (this.props.studyPage === 'introduction') {
                this.setState({
                    timeoutID: setTimeout(() => this.stopRecording(), 30000)
                })
            }
        } catch (err) {
            const faceCropSession = this.faceCropController;
            this.faceCropController = null;
            if (faceCropSession && typeof faceCropSession.abort === 'function') {
                faceCropSession.abort().finally(() => {
                    if (this.props.onFaceCropSessionFinished) this.props.onFaceCropSessionFinished(faceCropSession);
                });
            }
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
            jatos.uploadResultFile(blob, resolveStudyResultId(this.props) + '_' + this.props.studyPage + '_' + this.props.videoCounter + fileExtension)//eslint-disable-line no-undef
                // Mark success only on resolved upload; do not mark success after a failed attempt.
                .then(() => this.props.markVideoAsUploaded(uploadId))
                .catch((error) => {
                    console.log(error);
                    this.props.markVideoAsFailed(uploadId);
                });
        }
    }

    stopMediaRecorder() {
        this.recordingStopRequested = true;
        if (this.recorderStopPromise) return this.recorderStopPromise;
        const recorder = this.mediaStreamRecorder;
        if (!recorder || recorder.state === 'inactive') return Promise.resolve();
        this.recorderStopPromise = new Promise(resolve => {
            const previousOnStop = recorder.onstop;
            recorder.onstop = event => {
                try { if (previousOnStop) previousOnStop(event); }
                finally { resolve(); }
            };
            try { recorder.stop(); } catch (error) { resolve(); }
        });
        return this.recorderStopPromise;
    }

    registerFaceCropSession(session) {
        if (!session) return;
        // The component owns recorder cleanup; the library handle stays unchanged.
        const finish = async operation => {
            const recorderStop = this.stopMediaRecorder();
            try { return await operation(); }
            finally { await recorderStop; }
        };
        const coordinated = {
            captureId: session.captureId,
            prepare: () => session.prepare(),
            start: () => session.start(),
            stop: () => finish(() => session.stop()),
            abort: () => finish(() => session.abort())
        };
        this.faceCropController = coordinated;
        if (this.props.onFaceCropSessionCreated) this.props.onFaceCropSessionCreated(coordinated);
    }

    async stopRecording({deferFaceCropStop = false} = {}) {
        if (this.stopPromise) return this.stopPromise;
        // Stop both pipelines together: recorder stop triggers MP4/WebM upload,
        // and face-crop stop flushes worker/sink state before teardown completes.
        const faceCropSession = this.faceCropController;
        this.faceCropController = null;
        this.stopPromise = (async () => {
            const faceCropStop = deferFaceCropStop ? Promise.resolve() : stopFaceCropCaptureSession(faceCropSession);
            const recorderStop = this.stopMediaRecorder();
            await Promise.allSettled([Promise.resolve(faceCropStop), recorderStop]);
            if (faceCropSession && !deferFaceCropStop && this.props.onFaceCropSessionFinished) {
                this.props.onFaceCropSessionFinished(faceCropSession);
            }
        })();
        return this.stopPromise;
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
                    if (this.props.studyPage === "introduction") {
                        this.faceCropController = prepareFaceCropCaptureSession({webcam: this.webcamRef.current, props: this.props});
                        this.registerFaceCropSession(this.faceCropController);
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
