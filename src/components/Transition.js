import React from "react";
import i18next from "i18next";
import {CancelButton} from "./CancelButton";
import Button from "@material-ui/core/Button";

export default class Transition extends React.Component {
    render() {
        return <div className="container-fluid">
            <div className="row justify-content-center">
                <div className="col-12 p-0">
                    <h3 className="py-2 free-speech-tutorial-header">
                        {i18next.t('transition.header')}
                    </h3>
                </div>
            </div>
            <div className="row">
                <div className="col-12 visual-analog-scale">
                    <div>{i18next.t('transition.text_0')}</div>
                </div>
            </div>
            <div className="row p-2">
                <div className="col-12 visual-analog-scale">
                    { this.props.studyPage === "speechTaskTutorial"
                    ? <div>{i18next.t('transition.text_1')}</div>
                    : <div>{i18next.t('transition.text_2')}</div>}
                </div>
            </div>
            <div className="row justify-content-center align-items-center pb-3">
                <div className="p-2">
                    <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                </div>
                <div className="p-2">
                    <Button
                        variant="contained"
                        size="medium"
                        className="alert-buttons"
                        onClick={this.props.handleNext}
                    >
                        {i18next.t('stepper.button_next')}
                    </Button>
                </div>
            </div>
        </div>
    }
}
