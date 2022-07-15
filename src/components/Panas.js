import React from "react";
import Checkbox from '@material-ui/core/Checkbox';
import i18next from "i18next";
import RateReviewIcon from '@material-ui/icons/RateReview';
import Button from "@material-ui/core/Button";
import {CancelButton} from "./CancelButton";
import Card from "@material-ui/core/Card";

function QuestionnaireRow({ propositionName, proposition,handleChange }) {
    const [state, setState] = React.useState({
        checked0: false,
        checked1: false,
        checked2: false,
        checked3: false,
        checked4: false,
    });
    const [last, setLast] = React.useState(null);

    const updateCheckBox = (event) => {
        handleChange(propositionName, event.target.name)
        if(last !== null && last !== event.target.name) {
            setState({ ...state,
                [event.target.name]: event.target.checked,
                [last]: false });
            setLast(event.target.name)
        } else if (last !== null && last === event.target.name) {
            setState({ ...state, [event.target.name]: event.target.checked});
        } else {
            setState({ ...state, [event.target.name]: event.target.checked});
            setLast(event.target.name)
        }
    };
    return (
        <tr className="border-bottom border-dark">
            <th scope="row">
                <div className="px-0 py-4 panas-proposition">
                    {proposition}
                </div>
            </th>
            <td>
                <Checkbox
                    checked={state.checked0}
                    name="checked0"
                    onChange={updateCheckBox}
                />
            </td>
            <td>
                <Checkbox
                    checked={state.checked1}
                    name="checked1"
                    onChange={updateCheckBox}
                />
            </td>
            <td>
                <Checkbox
                    checked={state.checked2}
                    name="checked2"
                    onChange={updateCheckBox}
                />
            </td>
            <td>
                <Checkbox
                    checked={state.checked3}
                    name="checked3"
                    onChange={updateCheckBox}
                />
            </td>
            <td>
                <Checkbox
                    checked={state.checked4}
                    name="checked4"
                    onChange={updateCheckBox}
                />
            </td>
        </tr>
    );
}

export default class Panas extends React.Component {
    constructor() {
        super();

        this.state = {
            propositions: {
                'active': null,
                'upset': null,
                'hostile': null,
                'inspired': null,
                'ashamed': null,
                'alert': null,
                'nervous': null,
                'determined': null,
                'attentive': null,
                'afraid': null
            },
            startTimeOfPanas:null,
            allInputsChanged:false,
            showWarning:false
        }
        this.handleChange = this.handleChange.bind(this)
    }

    componentDidMount() {
        this.setState({startTimeOfPanas: Date.now() - this.props.referenceTime})
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if(this.state.allInputsChanged !== true){
            if(Object.values(this.state.propositions).indexOf(null) > -1) {
            } else {
                this.setState({allInputsChanged:true})
            }
        }
    }

    handleChange(proposition, value){
        let propositionsTemp = this.state.propositions
        propositionsTemp[proposition] = value
        this.setState({propositions:propositionsTemp})
    }

    render() {
        return (
            <div>
                <Card>
                    <div className="row py-2 justify-content-center index-body-header">
                        {i18next.t('panas.header')}
                    </div>
                </Card>
                <div className="row panas-subheader py-4">
                    <div className="col-12">
                        <div >
                            {i18next.t("panas.introText_0")}
                        </div>
                        <div className="pt-1">
                            {i18next.t("panas.introText_1")}
                        </div>
                    </div>
                </div>
                <table className="panas-table">
                    <thead>
                    <tr className="panas-labels p-1">
                        <th className="sticky-header">
                            <RateReviewIcon/>
                        </th>
                        <th className="sticky-header">
                            <div className="vertical m-2">
                                {i18next.t('panas.labels.0')}
                            </div>
                        </th>
                        <th className="sticky-header">
                            <div className="vertical m-2">
                                {i18next.t('panas.labels.1')}
                            </div>
                        </th>
                        <th className="sticky-header">
                            <div className="vertical m-2">
                                {i18next.t('panas.labels.2')}
                            </div>
                        </th>
                        <th className="sticky-header">
                            <div className="vertical m-2">
                                {i18next.t('panas.labels.3')}
                            </div>
                        </th>
                        <th className="sticky-header">
                            <div className="vertical m-2">
                                {i18next.t('panas.labels.4')}
                            </div>
                        </th>
                    </tr>
                    </thead>
                    <tbody>
                    <QuestionnaireRow propositionName={'active'} proposition={i18next.t('panas.proposition.active')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'upset'} proposition={i18next.t('panas.proposition.upset')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'hostile'} proposition={i18next.t('panas.proposition.hostile')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'inspired'} proposition={i18next.t('panas.proposition.inspired')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'ashamed'} proposition={i18next.t('panas.proposition.ashamed')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'alert'} proposition={i18next.t('panas.proposition.alert')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'nervous'} proposition={i18next.t('panas.proposition.nervous')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'determined'} proposition={i18next.t('panas.proposition.determined')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'attentive'} proposition={i18next.t('panas.proposition.attentive')} handleChange={this.handleChange}/>
                    <QuestionnaireRow propositionName={'afraid'} proposition={i18next.t('panas.proposition.afraid')} handleChange={this.handleChange} />
                    </tbody>
                </table>
               <div className="row justify-content-center align-items-center py-3">
                    {this.state.showWarning ?
                        <div className="feedbackVAS py-2">
                            {i18next.t('warnungPANAS')}
                        </div>
                        :
                        null
                    }
                    {this.props.studyPage === 'endPage'
                        ? <div className="p-2">
                            <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                        </div>
                        : null
                    }
                    <div className="p-2">
                        <Button
                            variant="contained"
                            size="medium"
                            className="alert-buttons"
                            onClick={() => {
                                if(this.state.allInputsChanged === true) {
                                    this.props.continueFromPanas(this.state.propositions, this.state.startTimeOfPanas)
                                } else {
                                    this.setState({showWarning:true})
                                }
                            }}
                        >
                            {i18next.t('stepper.button_next')}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}