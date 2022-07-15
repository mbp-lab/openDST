import React, {useEffect} from 'react';
import { makeStyles } from '@material-ui/core/styles';
import FormLabel from '@material-ui/core/FormLabel';
import FormControl from '@material-ui/core/FormControl';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import i18next from "i18next";
import createMuiTheme from "@material-ui/core/styles/createMuiTheme";
import {MuiThemeProvider} from "@material-ui/core";
import Radio from "@material-ui/core/Radio";
import RadioGroup from "@material-ui/core/RadioGroup";

const useStyles = makeStyles({
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
        display: 'inline-block'

    }
});
const THEME = createMuiTheme({
    typography: {
        "fontFamily": `"Catamaran", "Helvetica", "Arial", sans-serif`,
    }
});

export default function CheckboxForPriorParticipation({handlerCheckBoxForPriorParticipation}) {
    const classes = useStyles();

    const [participated, setParticipated] = React.useState(false);

    function handleRadioChange(event) {
        setParticipated(event.target.value);
    }

    useEffect(() => {
        handlerCheckBoxForPriorParticipation(participated)
    }, [handlerCheckBoxForPriorParticipation, participated])

    return (
        <div className="" >
            <MuiThemeProvider theme={THEME}>
                <FormControl className={classes.root} component="fieldset">
                    <FormLabel className={classes.formLabel} component="legend">{i18next.t('checking_participation.question')}</FormLabel>
                    <RadioGroup value={participated} onChange={handleRadioChange} className="justify-content-center">
                        <FormControlLabel
                            value="true"
                            className={classes.formControlLabel}
                            control={
                                <Radio
                                    color="primary"
                                />}
                            label={i18next.t('checking_participation.yes')}
                        />
                        <FormControlLabel
                            value="false"
                            className={classes.formControlLabel}
                            control={
                                <Radio
                                    color="primary"
                                />}
                            label={i18next.t('checking_participation.no')}
                        />
                    </RadioGroup>
                </FormControl>
            </MuiThemeProvider>
        </div>
    );
}
