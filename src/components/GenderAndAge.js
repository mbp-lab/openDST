import React from "react";
import i18next from 'i18next';
import InputLabel from '@material-ui/core/InputLabel';
import MenuItem from '@material-ui/core/MenuItem';
import FormControl from '@material-ui/core/FormControl';
import Select from '@material-ui/core/Select';
import TextField from '@material-ui/core/TextField';
import Button from "@material-ui/core/Button";
import CircularProgress from '@material-ui/core/CircularProgress';
import FeedbackChart from "./FeedbackChart";
import {CancelButton} from "./CancelButton";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";

export default class GenderAndAge extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            age: '',
            gender: '',
            showSelects: true,
            showProgress: false,
        }
        this.handleInput = this.handleInput.bind(this);
    }

    handleInput(event) {
        if (event.target.id === 'age') {
            this.setState({age: event.target.value})
        } else {
            this.setState({gender: event.target.value})
        }
    }

    render() {
        const selectForms = {
            minWidth: 120,
            width: 25
        };
        return <>
            <Card>
                <div className="row">
                    <div className="col-12">
                        <h3 className="index-body-header py-2">
                            {i18next.t("genderAndAge.introduction_header")}
                        </h3>
                    </div>
                </div>
                <CardContent>
                    <div className="row">
                        <FeedbackChart
                            currentQuestion={3}
                            questionCurrentInSeconds={100}
                            currentCorrect={2}
                            averageScore = {this.state.showSelects ? 0 : 75}
                        />
                    </div>
                    {this.state.showSelects
                        ? <>
                            <div className="row justify-content-center">
                                <div className="col-12 ">
                                    <div className="row py-2 justify-content-center p-0">
                                        {i18next.t('genderAndAge.introduction_text')}
                                    </div>
                                </div>
                            </div>
                            <div className="row align-items-center">
                                <div className="col-6">
                                    <FormControl>
                                        <InputLabel id="demo-simple-select-label">{i18next.t("genderAndAge.formControll.gender")}</InputLabel>
                                        <Select
                                            style={selectForms}
                                            labelId="demo-simple-select-label"
                                            id="gender"
                                            value={this.state.gender}
                                            onChange={this.handleInput}
                                        >
                                            <MenuItem value={"male"}>{i18next.t("genderAndAge.formControll.male")}</MenuItem>
                                            <MenuItem value={"female"}>{i18next.t("genderAndAge.formControll.female")}</MenuItem>
                                            <MenuItem value={"other"}>{i18next.t("genderAndAge.formControll.others")}</MenuItem>
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        id="age"
                                        type={'number'}
                                        label={i18next.t("genderAndAge.age")}
                                        style={selectForms}
                                        value={this.state.age}
                                        onChange={this.handleInput}
                                    />
                                </div>
                                <div className="col-6 align-items-center align-content-center">
                                    { this.state.showProgress ? <CircularProgress />
                                        : <Button
                                            variant="contained"
                                            size="medium"
                                            className="alert-buttons"
                                            onClick={() => {
                                                if (this.state.gender !== '' && this.state.age !== '' ){
                                                    this.setState({
                                                        showProgress:true
                                                    })
                                                    setTimeout(()=>{
                                                        this.setState({
                                                            showSelects:false
                                                        })
                                                    }, 2000)
                                                }
                                            }}
                                        >
                                            {i18next.t("genderAndAge.calculate")}
                                        </Button>}
                                </div>
                            </div>
                        </>
                        : <div className="row justify-content-center">
                            <div className="col-12 ">
                                <ul className="list-styled ul stepper-bullet-point">
                                    <li className="py-2">
                                        {i18next.t('genderAndAge.adjustment')}
                                    </li>
                                </ul>
                            </div>
                        </div>
                    }
                </CardContent>
            </Card>
            {this.state.showSelects
                ? <div className="row justify-content-center align-items-center">
                    <div className="p-2">
                        <CancelButton handleCancelDialog={this.props.handleCancelDialog}/>
                    </div>
                </div>
                : <div className="row justify-content-center align-items-center">
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
                                this.props.genderAndAgeHandler(this.state.age, this.state.gender)
                            }}>
                            {i18next.t("genderAndAge.continue")}
                        </Button>
                    </div>
                </div>
            }
        </>
    }
}