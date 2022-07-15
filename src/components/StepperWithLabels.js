import React from 'react';
import {createMuiTheme, ThemeProvider} from '@material-ui/core/styles';
import Stepper from '@material-ui/core/Stepper';
import Step from '@material-ui/core/Step';
import StepLabel from '@material-ui/core/StepLabel';
import i18next from "i18next";

const theme = createMuiTheme({
    overrides: {
        MuiStepIcon:{
            root: {
                '&$completed': {
                    color: '#fdcc52',
                },
                '&$active': {
                    color: '#fdcc52'
                }
            },
            text: {
                color: 'black'
            }
        },
        MuiButton: {
            root: {
                borderRadius: '10px',
                padding: '8px 22px',
                margin: '5px',
                background: '#fdcc52',
                '&:hover': {
                    backgroundColor: '#fdcc52',
                },
                '&:active': {
                    backgroundColor: '#fdcc52',
                },
            },
            text: {
                textColor: 'black',
            },
            containedSizeLarge: {
                padding: '8px 22px',
                background: "#fdcc52"
            },
        }
    }
});

export default function StepperWithLabels(props) {
    function getStepsAndCounter(slideSequences, studyPage) {
        let list = [];
        let counter = props.slideIndex;
        if (props.studyPagesSequence.indexOf('mathTaskTutorial') < props.studyPagesSequence.indexOf('speechTaskTutorial')) {
            if (studyPage === 'introduction' || studyPage === 'mathTaskTutorial') {
                for (let i = 0; i < slideSequences[studyPage].length; i++) {
                    list.push(i18next.t(`stepper.${studyPage}.${slideSequences[studyPage][i]}`))
                }
            } else if (studyPage === 'mathTaskResult' || studyPage === 'speechTaskTutorial') {
                for (let i = 0; i < slideSequences['mathTaskResult'].length; i++) {
                    list.push(i18next.t(`stepper.mathTaskResult.${slideSequences['mathTaskResult'][i]}`))
                }
                for (let i = 0; i < slideSequences['speechTaskTutorial'].length; i++) {
                    list.push(i18next.t(`stepper.speechTaskTutorial.${slideSequences['speechTaskTutorial'][i]}`))
                }
                if (studyPage === 'speechTaskTutorial') {
                    counter += slideSequences['mathTaskResult'].length;
                }
            } else {
                for (let i = 0; i < slideSequences[studyPage].length; i++) {
                    list.push(i18next.t(`stepper.${studyPage}.${slideSequences[studyPage][i]}`))
                }
            }
        } else {
            if (studyPage === 'introduction' || studyPage === 'speechTaskTutorial') {
                for (let i = 0; i < slideSequences['introduction'].length; i++) {
                    list.push(i18next.t(`stepper.introduction.${slideSequences['introduction'][i]}`))
                }
                for (let i = 0; i < slideSequences['speechTaskTutorial'].length; i++) {
                    list.push(i18next.t(`stepper.speechTaskTutorial.${slideSequences['speechTaskTutorial'][i]}`))
                }
                if (studyPage === 'speechTaskTutorial') {
                    counter += slideSequences['introduction'].length;
                }
            } else if (studyPage === 'mathTaskTutorial') {
                for (let i = 0; i < slideSequences['mathTaskTutorial'].length; i++) {
                    list.push(i18next.t(`stepper.mathTaskTutorial.${slideSequences['mathTaskTutorial'][i]}`))
                }
            } else if (studyPage === 'mathTaskResult' || studyPage === 'endPage') {
                for (let i = 0; i < slideSequences['mathTaskResult'].length; i++) {
                    list.push(i18next.t(`stepper.mathTaskResult.${slideSequences['mathTaskResult'][i]}`))
                }
                for (let i = 0; i < slideSequences['endPage'].length; i++) {
                    list.push(i18next.t(`stepper.endPage.${slideSequences['endPage'][i]}`))
                }
                if (studyPage === 'endPage') {
                    counter += slideSequences['mathTaskResult'].length;
                }
            } else {
                for (let i = 0; i < slideSequences[studyPage].length; i++) {
                    list.push(i18next.t(`stepper.${studyPage}.${slideSequences[studyPage][i]}`))
                }
            }
        }
        // this filters out a duplicate entry on mood because it results in there being 5 steps in the introduction which bloats the screen width
        if (slideSequences[studyPage].includes("vas") && slideSequences[studyPage].includes("panas")) {
            list = [...new Set(list)];
            if (slideSequences[studyPage].indexOf("panas") <= props.slideIndex) {
                counter--;
            }
        }
        return {steps: list, stepCounter: counter};
    }
    const {steps, stepCounter} = getStepsAndCounter(props.slideSequences, props.studyPagesSequence[props.pageIndex])
    return (
        <div className="row p-0">
            <div className="col-md-12 p-0">
                <ThemeProvider theme={theme}>
                    <Stepper activeStep={stepCounter} alternativeLabel className="pb-2">
                        {steps.map((label, index) => (
                            <Step key={label + index}>
                                <StepLabel>{label}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>
                </ThemeProvider>
            </div>
        </div>
    );
}
