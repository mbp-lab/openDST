import React from 'react';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import i18next from "i18next";

export default function AbortDialog(props) {
    return (
        <Dialog
            className="justify-content-center"
            open={props.abortDialogIsOpen}
            onClose={props.handleAbortDialog}
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
                    {i18next.t('alertAbortStudy.question')}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <div className="center-horizontal">
                    <div className="p-2">
                        <Button
                            className="alert-buttons"
                            onClick={props.handleAbortDialog}
                        >
                            {i18next.t('alertAbortStudy.disagree')}
                        </Button>
                    </div>
                    <div className="p-2">
                        <Button
                            onClick={() => {
                                // eslint-disable-next-line no-undef
                                jatos.abortStudy("participant aborted by pressing abort button");
                            }}
                            className="alert-buttons"
                        >
                            {i18next.t('alertAbortStudy.agree')}
                        </Button>
                    </div>
                </div>
            </DialogActions>
        </Dialog>
    );
}