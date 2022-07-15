import React from 'react';

class Redirection extends React.Component {

    redirect(language, dataId, studyId, studyResultId) {
        let searchParams = new URLSearchParams([["lang", language], ["version", "dst"], ["mode", "reg"], ["studyID", studyId], ["studyResultID", studyResultId], ["data", dataId]])
        window.location = process.env.REACT_APP_DEBRIEFING_HOST_PATH + "?" + searchParams.toString();
    }

    componentDidMount() {
        if (process.env.NODE_ENV !== "development") {
            let config;
            let searchParams;
            switch (this.props.cancelValue) {
                case "cancel_without_data":
                    this.props.handleCancelDialog();
                    // eslint-disable-next-line no-undef
                    jatos.abortStudyAjax("study cancelled and no data saved")
                        .then(() => this.redirect(this.props.studyMetaTracker.language, 0, this.props.studyMetaTracker.studyId, this.props.studyMetaTracker.studyResultId))
                        .catch((error) => console.log(error))
                    break;
                case "cancel_no_video":
                    config = new Blob([`save_without_video\n${Date.now()}\n${this.props.studyMetaTracker.studyTitle}\n${this.props.studyMetaTracker.studyUuid}`], {type: 'text/plain'})
                    searchParams = new URLSearchParams([["lang", this.props.studyMetaTracker.language], ["version", "dst"], ["mode", "reg"], ["studyID", this.props.studyMetaTracker.studyId], ["studyResultID", this.props.studyMetaTracker.studyResultId], ["data", 1]])
                    this.props.handleCancelDialog();
                    this.props.uploadFinalData(config, false);
                    // eslint-disable-next-line no-undef
                    jatos.endStudyAndRedirect(process.env.REACT_APP_DEBRIEFING_HOST_PATH + "?" + searchParams.toString())
                        .catch((error) => console.log(error))
                    break;
                case "cancel_with_video":
                    config = new Blob([`save_all_data\n${Date.now()}\n${this.props.studyMetaTracker.studyTitle}\n${this.props.studyMetaTracker.studyUuid}`], {type: 'text/plain'})
                    searchParams = new URLSearchParams([["lang", this.props.studyMetaTracker.language], ["version", "dst"], ["mode", "reg"], ["studyID", this.props.studyMetaTracker.studyId], ["studyResultID", this.props.studyMetaTracker.studyResultId], ["data", 2]])
                    this.props.handleCancelDialog();
                    this.props.uploadFinalData(config, true);
                    jatos.endStudyAndRedirect(process.env.REACT_APP_DEBRIEFING_HOST_PATH + "?" + searchParams.toString()) //eslint-disable-line no-undef
                        .catch((error) => console.log(error))
                    break;
                default:
                    break;
            }
        }
    };
    render() {return null;}
}
export default Redirection;
