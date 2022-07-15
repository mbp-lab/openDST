import Slide from "@material-ui/core/Slide";
import VisualAnalogueScale from "../components/VisualAnalogueScale";
import React from "react";
import i18next from "i18next";
import Button from "@material-ui/core/Button";
import {CancelButton} from "../components/CancelButton";
import Transition from "../components/Transition";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";

export default class SpeechTaskTutorial extends React.Component {

    render() {
        return (
            <div className="darken-background">
                <Slide direction="right" in={this.props.activeSlide === 'vas'} mountOnEnter unmountOnExit>
                    <VisualAnalogueScale
                        stressImpression={'intermediate'}
                        handBackStressData={this.props.handBackStressData}
                        handleNext={this.props.handleNext}
                        handleCancelDialog={this.props.handleCancelDialog}
                    />
                </Slide>
                <Slide direction="right" in={this.props.activeSlide === 'transition'} mountOnEnter unmountOnExit>
                    <Transition
                        studyPage="speechTaskTutorial"
                        handleCancelDialog={this.props.handleCancelDialog}
                        handleNext={this.props.handleNext}
                    />
                </Slide>
                <Slide direction="right" in={this.props.activeSlide === 'intro'} mountOnEnter unmountOnExit>
                    <div>
                        <Card>
                            <div className="row">
                                <div className="col-12 p-0">
                                    <h3 className="index-body-header py-2">
                                        {i18next.t('speechTaskTutorial.task.heading')}
                                    </h3>
                                </div>
                            </div>
                            <CardContent className="py-0">
                                <div className="row">
                                    <div className="col-12">
                                        <ul className="list-styled ul stepper-bullet-point">
                                            <li className="pb-1">{i18next.t('speechTaskTutorial.task.text_0')}</li>
                                            <li className="pb-1">
                                                {i18next.t('speechTaskTutorial.task.text_1.text_0')}
                                                <strong>{i18next.t('speechTaskTutorial.task.text_1.text_1')}</strong>
                                                {i18next.t('speechTaskTutorial.task.text_1.text_2')}
                                                <u>{i18next.t('speechTaskTutorial.task.text_1.text_3')}</u>
                                                {i18next.t('speechTaskTutorial.task.text_1.text_4')}
                                                <u>{i18next.t('speechTaskTutorial.task.text_1.text_5')}</u>
                                                {i18next.t('speechTaskTutorial.task.text_1.text_6')}
                                            </li>
                                            <li className="pb-1">
                                                {i18next.t('speechTaskTutorial.task.text_2.text_0')}
                                                <strong>{i18next.t('speechTaskTutorial.task.text_2.text_1')}</strong>
                                                {i18next.t('speechTaskTutorial.task.text_2.text_2')}
                                            </li>
                                            <li className="pb-1">{i18next.t('speechTaskTutorial.task.text_3')}</li>
                                            <li className="pb-1">{i18next.t('speechTaskTutorial.task.text_4')}</li>
                                        </ul>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <div className="row justify-content-center pb-3 align-items-center">
                            <div className="p-2">
                                <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                            </div>
                            <div className="p-2">
                                <Button
                                    variant="contained"
                                    size="medium"
                                    className="alert-buttons"
                                    onClick={() => {
                                        this.props.handleNext()
                                    }}
                                >
                                    {i18next.t('stepper.button_next')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Slide>
            </div>
        )
    }
}
