import Slide from "@material-ui/core/Slide";
import React from "react";
import i18next from "i18next";
import Button from "@material-ui/core/Button";
import GenderAndAge from "../components/GenderAndAge";
import AbortDialog from "../components/AbortDialog";
import {CancelButton} from "../components/CancelButton";
import CountdownBeforeTask from "../components/CountdownBeforeTask";
import VisualAnalogueScale from "../components/VisualAnalogueScale";
import Transition from "../components/Transition";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";


export default class MathTaskTutorial extends React.Component{
    constructor() {
        super();
        this.state = {
            abortDialogIsOpen: false,

            checkBoxBackground: false,
            checkBoxInfo: false,
            checkBoxProcessing: false,
            checkBoxConfirm: false,
        }
        this.handleAbortDialog = this.handleAbortDialog.bind(this);
    }

    handleAbortDialog(){
        this.setState({
            abortDialogIsOpen: !this.state.abortDialogIsOpen,
        });
    }

    render() {
        return <>
            <Slide direction="right" in={this.props.activeSlide === 'transition'} mountOnEnter unmountOnExit>
                <Transition
                    studyPage="mathTaskTutorial"
                    handleCancelDialog={this.props.handleCancelDialog}
                    handleNext={this.props.handleNext}
                />
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'vas'} mountOnEnter unmountOnExit>
                <VisualAnalogueScale
                    stressImpression={'intermediate'}
                    handBackStressData={this.props.handBackStressData}
                    handleNext={this.props.handleNext}
                    handleCancelDialog={this.props.handleCancelDialog}
                />
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'intro'} mountOnEnter unmountOnExit>
                <div>
                    <Card>
                        <div className="row py-2 justify-content-center index-body-header">
                            {i18next.t('example.header')}
                        </div>
                        <CardContent className="py-0">
                            <div className="row justify-content-center">
                                <div className="col-12 ">
                                    <ul className="list-styled ul stepper-bullet-point">
                                        <li className="pb-1">{i18next.t('example.text0')}</li>
                                        <li className="pb-1">{i18next.t('example.text1')}</li>
                                        <li className="pb-1">{i18next.t('example.text2')}</li>
                                    </ul>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <div className="row justify-content-center align-items-center pb-2">
                        <div className="p-2">
                            <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                        </div>
                        <div className="p-2">
                            <Button
                                variant="contained"
                                size="medium"
                                className="alert-buttons"
                                onClick={this.props.handleNext}>
                                {i18next.t('button.continue')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'comparison'} mountOnEnter unmountOnExit>
                <GenderAndAge
                    handleNext={this.props.handleNext}
                    genderAndAgeHandler={this.props.genderAndAgeHandler}
                    handleCancelDialog={this.props.handleCancelDialog}
                />
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'countdown'} mountOnEnter unmountOnExit>
                <CountdownBeforeTask
                    startTask={this.props.startMathTask}
                />
            </Slide>
            <AbortDialog
                handleAbortDialog={this.handleAbortDialog}
                abortDialogIsOpen={this.state.abortDialogIsOpen}
            />
        </>
    }
}