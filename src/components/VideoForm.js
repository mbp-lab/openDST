import React from 'react';
import Radio from '@material-ui/core/Radio';
import RadioGroup from '@material-ui/core/RadioGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import FormControl from '@material-ui/core/FormControl';
import FormHelperText from '@material-ui/core/FormHelperText';
import FormLabel from '@material-ui/core/FormLabel';
import Button from '@material-ui/core/Button';
import i18next from "i18next";


export default function VideoForm(props) {
    const [videoValue, setVideoValue] = React.useState(null);
    const [faceValue, setFaceValue] = React.useState(null);
    const [helperText, setHelperText] = React.useState('');

    React.useEffect(
        ()=> {
            if(faceValue === "false" || videoValue === "false") {
                setHelperText(i18next.t('mediaTesting.alert'));
            }
        }, [faceValue, videoValue]
    )

    const handleRadioChange = (event) => {
        if(event.target.name === 'video') {
            setVideoValue(event.target.value);
            setHelperText(' ');
        } else {
            setFaceValue(event.target.value);
            setHelperText(' ');
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if(faceValue === undefined || videoValue === undefined) {
            setHelperText(i18next.t('mediaTesting.answerQuestions'))
        } else {
            props.checkFormAndContinue(faceValue, videoValue)
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <FormHelperText className="form-helper">{helperText}</FormHelperText>
            <FormControl component="fieldset" id="video" className="visual-analog-scale">
                <FormLabel component="legend" className="form-label-1">{i18next.t('mediaTesting.question_01')}</FormLabel>
                <RadioGroup value={videoValue} name="video" onChange={handleRadioChange} aria-label="video" row className="justify-content-center">
                    <FormControlLabel
                        value="true"
                        control={
                            <Radio
                                color="primary"
                            />}
                        label={i18next.t('mediaTesting.yes')}
                        labelPlacement="end"
                    />
                    <FormControlLabel
                        value="false"
                        control={
                            <Radio
                                color="primary"
                            />}
                        label={i18next.t('mediaTesting.no')}
                        labelPlacement="end"
                    />
                </RadioGroup >
            </FormControl>
            <FormControl component="fieldset">
                <FormLabel component="legend" className="form-label-1" >{i18next.t('mediaTesting.question_02')}</FormLabel>
                <RadioGroup value={faceValue} name="face" onChange={handleRadioChange} aria-label="face" row className="justify-content-center">
                    <FormControlLabel
                        value="true"
                        control={
                            <Radio
                                color="primary"
                            />}
                        label={i18next.t('mediaTesting.yes')}
                        labelPlacement="end"
                    />
                    <FormControlLabel
                        value="false"
                        control={
                            <Radio
                                color="primary"
                            />}
                        label={i18next.t('mediaTesting.no')}
                        labelPlacement="end"
                    />
                </RadioGroup >
            </FormControl>
            <div className="row align-items-end mb-2">
                <div className="col-12">
                    <div className="col-12">
                        <Button
                            type="submit"
                            className="alert-buttons"
                            size="medium">
                            {i18next.t('mediaTesting.continue')}
                        </Button>
                    </div>
                </div>
            </div>
        </form>
    );
}
