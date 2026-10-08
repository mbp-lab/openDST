import React from 'react';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import i18next from "i18next";
import FormControl from "@material-ui/core/FormControl";
import {CircularProgress, FormControlLabel, Radio, RadioGroup} from "@material-ui/core";
import Redirection from "./Redirection";
import {abortActiveFacecropCapture, stopActiveFacecropCapture} from '../facecropAdapter';

export default function CancelDialog(props) {
    const [cancelValue, setCancelValue] = React.useState("cancel_without_data");
    const [showButton, setShowButton] = React.useState(true);
    const [redirectAllowed, setRedirectAllowed] = React.useState(false);
    const [forceRedirect, setForceRedirect] = React.useState(false);
    const timers = React.useRef([]);

    React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

    function handleChange(event) {
        setCancelValue(event.target.value);
    }

    async function handleOK() {
        if (cancelValue === "no_cancel") {
            props.handleCancelDialog();
            return;
        }
        setShowButton(false);
        // Preserve the existing escape hatch while normal cancellation waits for
        // capture closure and any final artifacts registered by graceful stop.
        if (cancelValue !== "cancel_without_data") {
            timers.current.push(setTimeout(() => {
                setForceRedirect(true);
                setRedirectAllowed(true);
            }, 180000));
        }
        const minimumDelay = new Promise(resolve => {
            timers.current.push(setTimeout(resolve, 500));
        });
        try {
            if (cancelValue === "cancel_with_video") await stopActiveFacecropCapture();
            else await abortActiveFacecropCapture();
        } catch (error) {
            console.error('Facecrop could not close during cancellation', error);
        }
        await minimumDelay;
        if (cancelValue === "cancel_without_data") setForceRedirect(true);
        setRedirectAllowed(true);
    }

    return (
        <Dialog
            open={props.cancelDialogIsOpen}
            onClose={props.handleCancelDialog}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
            <DialogTitle id="alert-dialog-title">
                {i18next.t('alertAbortStudy.header')}
            </DialogTitle>
            <DialogContent>
                <DialogContentText
                    id="alert-dialog-description alert"
                    className="alert-text"
                >
                    {i18next.t('cancelDialog.question')}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <FormControl component="fieldset">
                    <RadioGroup aria-label="cancel" name="cancel" value={cancelValue} onChange={showButton ? handleChange : undefined}>
                        <FormControlLabel value="cancel_without_data" control={<Radio />} label={i18next.t('cancelDialog.cancel_without_data')} />
                        <FormControlLabel value="cancel_no_video" control={<Radio />} label={i18next.t('cancelDialog.cancel_no_video')} />
                        <FormControlLabel value="cancel_with_video" control={<Radio />} label={i18next.t('cancelDialog.cancel_with_video')} />
                        <FormControlLabel value="no_cancel" control={<Radio />} label={i18next.t('cancelDialog.no_cancel')} />
                    </RadioGroup>
                </FormControl>
            </DialogActions>
            <DialogActions>
                <div className="center-horizontal">
                    {showButton
                        ? <Button
                            onClick={handleOK}
                            className="alert-buttons">OK</Button>
                        : ((props.areAllVideosUploaded || forceRedirect) && redirectAllowed
                                ? <Redirection handleCancelDialog={props.handleCancelDialog}
                                               cancelValue={cancelValue}
                                               uploadFinalData={props.uploadFinalData}
                                               studyMetaTracker={props.studyMetaTracker}
                                />
                                : <CircularProgress/>
                        )
                    }
                </div>
            </DialogActions>
        </Dialog>
    );
}
