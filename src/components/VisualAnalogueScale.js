import React from 'react';
import Slider from '@material-ui/core/Slider';
import {withStyles} from "@material-ui/core";
import Button from "@material-ui/core/Button";
import i18next from "i18next";
import {CancelButton} from "./CancelButton";
import Card from "@material-ui/core/Card";
import {calculateWidthInPx} from "../utils";

let width = calculateWidthInPx(85);

const PrettoSlider = withStyles({
    root: {
        color: '#0239ff',
        height: 8,
        width: width
    },
    thumb: {
        height: 20,
        width: 20,
        backgroundColor: '#fff',
        border: '2px solid currentColor',

        '&:focus, &:hover, &$active': {
            boxShadow: 'inherit',
        },
    },
    active: {},
    valueLabel: {
        left: 'calc(-50% + 4px)',
    },
    track: {
        height: 8,
        borderRadius: 4,
    },
    rail: {
        height: 8,
        borderRadius: 4,
    },
}) (Slider);

const style = {
    background: "#fdcc52",
    color: 'black',
};
export default class VisualAnalogueScale extends React.Component  {
    constructor(props) {
        super(props);
        this.state = {
            moodInput: {'stress':0, 'frustrated':0, 'overstrained':0, 'ashamed':0},
            allInputsChanged:false,
            showWarning:false
        }
        this.handleChangeStress = this.handleChangeStress.bind(this);
        this.handleChangeFrustrated = this.handleChangeFrustrated.bind(this);
        this.handleChangeOverStrained = this.handleChangeOverStrained.bind(this);
        this.handleChangeAshamed = this.handleChangeAshamed.bind(this);
    }
    componentDidUpdate(prevProps, prevState, snapshot) {
        if(this.state.allInputsChanged !== true){
            if(Object.values(this.state.moodInput).indexOf(null) > -1) {
            } else {
                this.setState({allInputsChanged:true})
            }
        }
    }

    handleChangeStress(event, value){
        let temp = this.state.moodInput
        temp.stress = value
        this.setState({moodInput:temp})
    }
    handleChangeFrustrated(event, value){
        let temp = this.state.moodInput
        temp.frustrated = value
        this.setState({moodInput:temp})
    }
    handleChangeOverStrained(event, value){
        let temp = this.state.moodInput
        temp.overstrained = value
        this.setState({moodInput:temp})
    }
    handleChangeAshamed(event, value){
        let temp = this.state.moodInput
        temp.ashamed = value
        this.setState({moodInput:temp})
    }

    render() {
        const marks = [
            {
                value: 2,
                label: (i18next.t('stress_scale.low'))
            },
            {
                value: 98,
                label: i18next.t('stress_scale.high')
            },
        ];
        let endingButton;
        if(this.props.stressImpression === 'intermediate') {
            endingButton =
                <div className="row justify-content-center align-items-center">
                    <div className="p-2">
                        <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                    </div>
                    <div className="p-2">
                        <Button
                            variant="contained"
                            size="medium"
                            className="alert-buttons"
                            onClick={() => {
                                if(this.state.allInputsChanged === true || this.state.showWarning) {
                                    this.props.handBackStressData(this.state.moodInput, this.props.stressImpression);
                                    this.props.handleNext()
                                } else {
                                    this.setState({showWarning:true})
                                }
                            }}>
                            {i18next.t('button.continue')}
                        </Button>
                    </div>
                </div>
        } else if(this.props.stressImpression === 'baseline') {
            endingButton =
                <div className="row justify-content-center align-items-center">
                    <div className="p-2">
                        <Button
                            variant="contained"
                            size="medium"
                            style={style}
                            onClick={() => {
                                if(this.state.allInputsChanged === true || this.state.showWarning) {
                                    this.props.handBackStressData(this.state.moodInput, this.props.stressImpression);
                                    window.scrollTo(0, 0)
                                    this.props.handleNext()
                                } else {
                                    this.setState({showWarning:true})
                                }

                            }}
                        >
                            {i18next.t('stress_scale.submit')}
                        </Button>
                    </div>
                </div>
        } else {
            endingButton =
                <div className="row justify-content-center align-items-center">
                    <div className="p-2">
                        <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                    </div>
                    <div className="p-2">
                        <Button
                            variant="contained"
                            size="medium"
                            className="alert-buttons"
                            onClick={() => {
                                if(this.state.allInputsChanged === true || this.state.showWarning) {
                                    this.props.handBackStressData(this.state.moodInput, this.props.stressImpression);
                                    window.scrollTo(0, 0)
                                    this.props.handleNext()
                                } else {
                                    this.setState({showWarning:true})
                                }
                            }}>
                            {i18next.t('button.continue')}
                        </Button>
                    </div>
                </div>
        }
        let headerText;
        if(this.props.stressImpression === 'intermediate') {
            headerText = [
                {
                    header: <u> {i18next.t('study_introduction_4.header2') } </u>,
                    listItem: [
                        i18next.t('study_introduction_4.text3'),
                        i18next.t('study_introduction_4.text5'),
                        i18next.t('study_introduction_4.text1'),
                        i18next.t('study_introduction_4.text2')
                    ]
                },
                {
                    header: i18next.t('study_introduction_5.header'),
                    listItem: [
                        i18next.t('study_introduction_5.text3'),
                        i18next.t('study_introduction_5.text1'),
                        i18next.t('study_introduction_5.text2')
                    ]
                },
                {
                    header: i18next.t('study_introduction_6.header'),
                    listItem: [
                        i18next.t('study_introduction_6.text3'),
                        i18next.t('study_introduction_6.text1'),
                        i18next.t('study_introduction_6.text2')
                    ]
                },
                {header: i18next.t('study_introduction_7.header'),
                    listItem: [
                        i18next.t('study_introduction_7.text0'),
                        i18next.t('study_introduction_7.text1'),
                        i18next.t('study_introduction_7.text2')
                    ]
                }
            ];
        } else if(this.props.stressImpression === 'end') {
            headerText = [
                {
                    header: i18next.t('study_introduction_4.header'),
                    listItem: [
                        i18next.t('study_introduction_4.text4'),
                        i18next.t('study_introduction_4.text5'),
                        i18next.t('study_introduction_4.text1'),
                        i18next.t('study_introduction_4.text2')
                    ]
                },
                {
                    header: i18next.t('study_introduction_5.header'),
                    listItem: [
                        i18next.t('study_introduction_5.text4'),
                        i18next.t('study_introduction_5.text1'),
                        i18next.t('study_introduction_5.text2')
                    ]
                },
                {
                    header: i18next.t('study_introduction_6.header'),
                    listItem: [
                        i18next.t('study_introduction_6.text4'),
                        i18next.t('study_introduction_6.text1'),
                        i18next.t('study_introduction_6.text2')
                    ]
                },
                {header: i18next.t('study_introduction_7.header'),
                    listItem: [
                        i18next.t('study_introduction_7.text0'),
                        i18next.t('study_introduction_7.text1'),
                        i18next.t('study_introduction_7.text2')
                    ]
                }
            ];
        } else {
            headerText = [
                {header: i18next.t('study_introduction_4.header'),
                    listItem: [
                        i18next.t('study_introduction_4.text0_1'),
                        i18next.t('study_introduction_4.text0_2'),
                        i18next.t('study_introduction_4.text1'),
                        i18next.t('study_introduction_4.text2')
                    ]
                },
                {header: i18next.t('study_introduction_5.header'),
                    listItem: [
                        i18next.t('study_introduction_5.text0'),
                        i18next.t('study_introduction_5.text1'),
                        i18next.t('study_introduction_5.text2')
                    ]
                },
                {header: i18next.t('study_introduction_6.header'),
                    listItem: [
                        i18next.t('study_introduction_6.text0'),
                        i18next.t('study_introduction_6.text1'),
                        i18next.t('study_introduction_6.text2')
                    ]
                },
                {header: i18next.t('study_introduction_7.header'),
                    listItem: [
                        i18next.t('study_introduction_7.text0'),
                        i18next.t('study_introduction_7.text1'),
                        i18next.t('study_introduction_7.text2')
                    ]
                }
            ];
        }
        let sliderManager = [
            ['stress', headerText[0]],
            ['frustrated', headerText[1]],
            ['overstrained', headerText[2], endingButton],
            ['ashamed', headerText[3], ]

        ];
        return <>
                <Card>
                    <div className="row py-2 justify-content-center index-body-header">
                        {sliderManager[0][1].header}
                    </div>
                </Card>
                        <div className="row justify-content-center py-3">
                            <div className="col-12">
                                <div className="text-center font-weight-bold visual-analog-scale">
                                    {sliderManager[0][1].listItem[0]}
                                </div>
                                <div className="text-center visual-analog-scale-intro">
                                    {sliderManager[0][1].listItem[1]}
                                </div>
                            </div>
                        </div>
                        <div className="p-1">
                            <div className="row text-center justify-content-center">
                                <div className="text-center visual-analog-scale">
                                    {sliderManager[0][1].listItem[2]}
                                    <div className="font-weight-bold visual-analog-scale">
                                        {sliderManager[0][1].listItem[3]}
                                    </div>
                                </div>
                            </div>
                            <div className="row text-center justify-content-center pb-3">
                                <div className="col-12">
                                    <PrettoSlider
                                        id="stress"
                                        onChange={this.handleChangeStress}
                                        value={this.state.moodInput.stress}
                                        aria-labelledby="discrete-slider-custom"
                                        valueLabelDisplay="auto"
                                        marks={marks}
                                        defaultValue={0}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-1">
                            <div className="row text-center justify-content-center">
                                <div className="text-center visual-analog-scale">
                                    {sliderManager[1][1].listItem[1]}
                                    <div className="font-weight-bold visual-analog-scale">{sliderManager[1][1].listItem[2]}</div>
                                </div>
                            </div>
                            <div className="row text-center justify-content-center pb-3">
                                <div className="col-12">
                                    <PrettoSlider
                                        id="frustrated"
                                        onChange={this.handleChangeFrustrated}
                                        value={this.state.moodInput.frustrated}
                                        aria-labelledby="discrete-slider-custom"
                                        valueLabelDisplay="auto"
                                        marks={marks}
                                        defaultValue={0}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-1">
                            <div className="row text-center justify-content-center">
                                <div className="text-center visual-analog-scale">
                                    {sliderManager[2][1].listItem[1]}
                                    <div className="font-weight-bold visual-analog-scale">{sliderManager[2][1].listItem[2]}</div>
                                </div>
                            </div>
                            <div className="row text-center justify-content-center">
                                <div className="col-12">
                                    <PrettoSlider
                                        id="overstrained"
                                        onChange={this.handleChangeOverStrained}
                                        value={this.state.moodInput.overstrained}
                                        aria-labelledby="discrete-slider-custom"
                                        valueLabelDisplay="auto"
                                        marks={marks}
                                        defaultValue={0}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-1">
                            <div className="row text-center justify-content-center">
                                <div className="text-center visual-analog-scale">
                                    {sliderManager[3][1].listItem[1]}
                                    <div className="font-weight-bold visual-analog-scale">{sliderManager[3][1].listItem[2]}</div>
                                </div>
                            </div>
                            <div className="row text-center justify-content-center">
                                <div className="col-12">
                                    <PrettoSlider
                                        id="ashamed"
                                        onChange={this.handleChangeAshamed}
                                        value={this.state.moodInput.ashamed}
                                        aria-labelledby="discrete-slider-custom"
                                        valueLabelDisplay="auto"
                                        marks={marks}
                                        defaultValue={0}
                                    />
                                </div>
                            </div>
                        </div>
                <div className="row text-center justify-content-center">
                    <div className="container-fluid">
                        <div className="p-2">
                            {this.state.showWarning ?
                                <div className="feedbackVAS">
                                    {i18next.t('warnungVAS')}

                                </div>
                                :
                                null
                            }
                        </div>
                        {endingButton}
                    </div>
                </div>
            </>
    }
}