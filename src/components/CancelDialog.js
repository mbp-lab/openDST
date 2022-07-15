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

export default function CancelDialog(props) {
    const [cancelValue, setCancelValue] = React.useState("cancel_without_data");
    const [showButton, setShowButton] = React.useState(true);
    const [redirectAllowed, setRedirectAllowed] = React.useState(false);
    const [forceRedirect, setForceRedirect] = React.useState(false);

    function handleChange(event) {
        setCancelValue(event.target.value);
    }

    // the redirection to the debriefing slides happens in Redirection which is only rendered after 0.5s AND if all videos have been uploaded
    function handleOK() {
        if (cancelValue === "cancel_with_video" || cancelValue === "cancel_no_video") {
            setTimeout(() => setRedirectAllowed(true), 500);
            setTimeout(() => setForceRedirect(true), 180000);
            setShowButton(false);
        } else {
            if (cancelValue === "cancel_without_data") {
                setTimeout(() => {
                    setRedirectAllowed(true);
                    setForceRedirect(true);
                    setShowButton(false);
                }, 500)
            } else {
                if (cancelValue === "no_cancel") {
                    props.handleCancelDialog();
                }
            }
        }
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
                    <RadioGroup aria-label="cancel" name="cancel" value={cancelValue} onChange={handleChange}>
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