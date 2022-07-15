import React from "react";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";
import {ThemeProvider} from "@material-ui/styles";
import FormControl from "@material-ui/core/FormControl";
import RadioGroup from "@material-ui/core/RadioGroup";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import Checkbox from "@material-ui/core/Checkbox";
import i18next from "i18next";
import CheckboxForPriorParticipation from "../components/CheckboxForPriorParticipation";
import Button from "@material-ui/core/Button";
import createMuiTheme from "@material-ui/core/styles/createMuiTheme";
import withStyles from "@material-ui/core/styles/withStyles";
import Slide from "@material-ui/core/Slide";
import Calibration from "../components/Calibration";
import VisualAnalogueScale from "../components/VisualAnalogueScale";
import Panas from "../components/Panas";
import AbortDialog from "../components/AbortDialog";


const styles = theme => ({
    root: {
        margin: '30px 15px',
        lineHeight: 1.2,
        fontSize: '1.15rem',
    },
    formLabel: {
        lineHeight: 1.2,
        fontSize: '1.15rem'
    },
    formControlLabel:{
        lineHeight: 1.2,
        fontSize: '1.15rem',
        display: 'inline-block',
        textAlign: 'left',
        justifyContent: 'start'
    },
});

const theme = createMuiTheme({
    typography: {
        "fontFamily": `"Catamaran", "Helvetica", "Arial", sans-serif`,
    }
});

class Introduction extends React.Component {
    constructor() {
        super();
        this.state = {
            abortDialogIsOpen: false,

            checkBoxBackground: false,
            checkBoxInfo: false,
            checkBoxProcessing: false,
            checkBoxConfirm: false,

            infoCounter: 0,
        }
        this.contentList = [
            process.env.REACT_APP_LOGGING === "true"
                ? {header: <u> {i18next.t('study_introduction_0.header') } </u>,
                    listItem: [i18next.t('study_introduction_0.text0'), i18next.t('study_introduction_0.text1'), i18next.t('study_introduction_0.text2')]
                }
                : {header: <u> {i18next.t('study_introduction_0.header') } </u>,
                    listItem: [i18next.t('study_introduction_0.text0'), i18next.t('study_introduction_0.text1'), i18next.t('study_introduction_0.text2'), <b>{i18next.t('study_introduction_0.text3')}</b>]
                }
            ,
            {header: <u> {i18next.t('study_introduction_1.header') } </u>,
                listItem: [i18next.t('study_introduction_1.text0_1'), i18next.t('study_introduction_1.text0_2'), i18next.t('study_introduction_1.text0_3'),i18next.t('study_introduction_1.text0_4'),i18next.t('study_introduction_1.text0_5'),]
            },
            {header: <u> {i18next.t('study_introduction_2.header') } </u>,
                listItem: [i18next.t('study_introduction_2.text0_1'), i18next.t('study_introduction_2.text0_2'),  i18next.t('study_introduction_2.text0_3'),i18next.t('study_introduction_2.text0_4')]
            },
            {header: <u> {i18next.t('study_introduction_3.header') } </u>,
                listItem: [i18next.t('study_introduction_3.text1'), i18next.t('study_introduction_3.text1_1'),
                    i18next.t('study_introduction_3.text2'),i18next.t('study_introduction_3.text3'),i18next.t('study_introduction_3.text3_2'),i18next.t('study_introduction_3.text4'),
                    <div>
                        {i18next.t('study_introduction_3.text5a')}
                        <Button variant="contained" color="secondary">{i18next.t('button.cancel')}</Button>
                        {i18next.t('study_introduction_3.text5b')}
                    </div>]
            }
        ]
        this.handleAbortDialog = this.handleAbortDialog.bind(this);
        this.handleChange = this.handleChange.bind(this);
    }

    manipulateInfoCounter(action) {
        if (action === 'back') {
            this.setState({infoCounter: this.state.infoCounter - 1})
        }
        if (action === 'continue') {
            if (this.state.infoCounter === 3) {
                this.props.handleNext();
            } else {
                this.setState({
                    infoCounter: this.state.infoCounter + 1
                })
            }
        }
    }

    handleChange(event) {
        this.setState( {[event.target.name]: event.target.checked})
    }

    handleAbortDialog(){
        this.setState({
            abortDialogIsOpen: !this.state.abortDialogIsOpen,
        });
    }

    checkProceeding() {
        if(!this.state.checkBoxBackground || !this.state.checkBoxInfo || !this.state.checkBoxProcessing || !this.state.checkBoxConfirm) {
            this.handleAbortDialog();
        } else {
            this.props.handleNext();
        }
    }

    render () {
        let arrayOfListElements = [];
        for (let i=0; i< this.contentList[this.state.infoCounter].listItem.length; ++i) {
            arrayOfListElements.push(
                <li className="pb-1" key={i}>{this.contentList[this.state.infoCounter].listItem[i]}</li>
            )
        }
        return <>
            <Slide direction="right" in={this.props.activeSlide === 'intro'} mountOnEnter unmountOnExit>
                <div>
                    <Card>
                        <div className="row">
                            <div className="col-12 p-0">
                                <h3 className="index-body-header px-3 py-2">
                                    {this.contentList[this.state.infoCounter].header}
                                </h3>
                            </div>
                        </div>
                        <CardContent className="py-0">
                            <ul className="list-styled ul stepper-bullet-point ">
                                {arrayOfListElements}
                            </ul>
                            {this.state.infoCounter === 3 &&
                            <p>
                                {this.props.language === 'de'
                                    ? <a className="additionalInfo"
                                         href={process.env.REACT_APP_ADDITIONAL_INFORMATION_URL_DE}>
                                        {i18next.t('study_introduction_3.additional_info')}</a>
                                    : <a className="additionalInfo"
                                         href={process.env.REACT_APP_ADDITIONAL_INFORMATION_URL_EN}>
                                        {i18next.t('study_introduction_3.additional_info')}</a>
                                }
                            </p>
                            }
                        </CardContent>
                    </Card>
                    {this.state.infoCounter === 0
                        ? <CheckboxForPriorParticipation handlerCheckBoxForPriorParticipation={this.props.handlerCheckBoxForPriorParticipation}/>
                        : <div/>
                    }
                    <div className="row justify-content-center">
                        {
                            this.state.infoCounter === 0
                                ? <div/>
                                : <div className="p-2">
                                    <Button
                                        variant="contained"
                                        size="medium"
                                        className="alert-buttons"
                                        onClick={ ()=> {
                                            this.manipulateInfoCounter('back')
                                        }}>
                                        {i18next.t('button.back')}
                                    </Button>
                                </div>
                        }
                        <div className="p-2">
                            <Button
                                variant="contained"
                                size="medium"
                                className="alert-buttons"
                                onClick={() => {
                                    this.manipulateInfoCounter('continue')
                                }}>
                                {i18next.t('button.continue')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'consent'} mountOnEnter unmountOnExit>
                <div>
                    <Card>
                        <div className="row">
                            <div className="col-12">
                                <h3 className="index-body-header py-2">
                                    {this.contentList[this.state.infoCounter].header}
                                </h3>
                            </div>
                        </div>
                        <CardContent className="py-0">
                            <ThemeProvider theme={theme}>
                                <FormControl component="fieldset">
                                    <RadioGroup className="justify-content-start">
                                        <div className=" text-left justify-content-start pb-3">
                                            <FormControlLabel
                                                className="text-left"
                                                control={<Checkbox checked={this.state.checkBoxBackground}
                                                                   onChange={this.handleChange}
                                                                   name="checkBoxBackground"/>}
                                                label={i18next.t('study_introduction_3_5.consensus_0')}
                                            />
                                        </div>
                                        <div className=" text-left justify-content-start pb-3">
                                            <FormControlLabel
                                                className="text-left"
                                                control={<Checkbox checked={this.state.checkBoxInfo}
                                                                   onChange={this.handleChange}
                                                                   name="checkBoxInfo"/>}
                                                label={<div>
                                                    {i18next.t('study_introduction_3_5.consensus_3a')}
                                                    {this.props.language === 'de'
                                                        ? <a className="additionalInfo"
                                                             href={process.env.REACT_APP_ADDITIONAL_INFORMATION_URL_DE}>
                                                            {i18next.t('study_introduction_3_5.consensus_3b')}</a>
                                                        : <a className="additionalInfo"
                                                             href={process.env.REACT_APP_ADDITIONAL_INFORMATION_URL_EN}>
                                                            {i18next.t('study_introduction_3_5.consensus_3b')}</a>
                                                    }
                                                    {i18next.t('study_introduction_3_5.consensus_3c')}
                                                </div>}
                                            />
                                        </div>
                                        <div className="pb-3">
                                            <FormControlLabel
                                                className="text-left"
                                                control={<Checkbox checked={this.state.checkBoxProcessing}
                                                                   onChange={this.handleChange}
                                                                   name="checkBoxProcessing"/>}
                                                label={i18next.t('study_introduction_3_5.consensus_1')}
                                            />
                                        </div>
                                        <div className="pb-3 font-weight-bold">
                                            <FormControlLabel
                                                className="text-left font-weight-bold"
                                                control={<Checkbox checked={this.state.checkBoxConfirm}
                                                                   onChange={this.handleChange}
                                                                   name="checkBoxConfirm"/>}
                                                label={<b> {i18next.t('study_introduction_3_5.consensus_2')} </b>}
                                            />
                                        </div>
                                    </RadioGroup>
                                </FormControl>
                            </ThemeProvider>
                        </CardContent>
                    </Card>
                    <div className="row justify-content-center">
                        <div className="p-2">
                            <Button
                                variant="contained"
                                className="alert-buttons"
                                size="medium"
                                onClick={() => {
                                    this.handleAbortDialog();
                                }}>
                                {i18next.t('button.disagree')}
                            </Button>
                        </div>
                        <div className="p-2">
                            <Button
                                variant="contained"
                                size="medium"
                                className="alert-buttons"
                                onClick={()=> {
                                    this.checkProceeding();
                                }}
                            >
                                {i18next.t('button.agree')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'vas'} mountOnEnter unmountOnExit>
                <VisualAnalogueScale
                    stressImpression={'baseline'}
                    handBackStressData={this.props.handBackStressData}
                    handleNext={this.props.handleNext}
                />
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'panas'} mountOnEnter unmountOnExit>
                <Panas
                    studyPage='baseline'
                    continueFromPanas={this.props.continueFromPanas}
                    referenceTime={this.props.referenceTime}
                />
            </Slide>
            <Slide direction="right" in={this.props.activeSlide === 'calibration'} mountOnEnter unmountOnExit>
                <Calibration
                    handleNext={this.props.handleNext}
                    markVideoAsUploading={this.props.markVideoAsUploading}
                    markVideoAsUploaded={this.props.markVideoAsUploaded}
                    studyResultId={this.props.studyResultId}
                    handleAbortDialog={this.handleAbortDialog}
                />
            </Slide>
            <AbortDialog
                handleAbortDialog={this.handleAbortDialog}
                abortDialogIsOpen={this.state.abortDialogIsOpen}
            />
        </>
    }
}

export default withStyles(styles, { withTheme: true })(Introduction);
