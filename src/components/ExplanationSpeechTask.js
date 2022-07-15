import React from 'react';
import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import MuiDialogContent from '@material-ui/core/DialogContent';
import MuiDialogActions from '@material-ui/core/DialogActions';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';
import Typography from '@material-ui/core/Typography';
import i18next from "i18next";
import TimerIcon from "@material-ui/icons/Timer";
import {CancelButton} from "./CancelButton";

const navigationBarPrepare =
    <div className="row speechTask-prepare-example justify-content-center align-content-center">
        <div className="col-10 ">
            <div className="speechTask-countdown ">
                <TimerIcon fontSize={'large'}/> 8:231
            </div>
        </div>
    </div>

const navigationBarSpeak =
    <div className="row speechTask-speak-example justify-content-center align-content-center">
        <div className="col-10">
            <div className="speechTask-countdown ">
                <TimerIcon fontSize={'large'}/> 19:412
            </div>
        </div>
    </div>

const styles = (theme) => ({
    root: {
        margin: 0,
        padding: theme.spacing(2),
    },
    closeButton: {
        position: 'absolute',
        right: theme.spacing(1),
        top: theme.spacing(1),
        color: theme.palette.grey[500],
    },
});

const DialogTitle = withStyles(styles)((props) => {
    const { children, classes, onClose, ...other } = props;
    return (
        <MuiDialogTitle disableTypography className={classes.root} {...other}>
            <Typography variant="h6">{children}</Typography>
            {onClose ? (
                <IconButton aria-label="close" className={classes.closeButton} onClick={onClose}>
                    <CloseIcon />
                </IconButton>
            ) : null}
        </MuiDialogTitle>
    );
});

const DialogContent = withStyles((theme) => ({
    root: {
        padding: theme.spacing(2),
    },
}))(MuiDialogContent);

const DialogActions = withStyles((theme) => ({
    root: {
        margin: 0,
        padding: theme.spacing(1),
    },
}))(MuiDialogActions);

export default function ExplanationSpeechTask(props) {
    const [open, setOpen] = React.useState(false);

    const handleClickOpen = () => {
        setOpen(true);
    };
    const handleClose = () => {
        props.changeStartExplanation()
        setOpen(false);
    };

    return (
        <div>
            <Button size="large" variant="outlined" className="speechTask-countdown-button" onClick={handleClickOpen}>
                {i18next.t('speechTask_explanation.start-button')}
            </Button>
            <div className="row justify-content-center align-items-center p-2">
                <CancelButton handleCancelDialog={props.handleCancelDialog}/>
            </div>
            <Dialog onClose={handleClose} aria-labelledby="customized-dialog-title" open={open}>
                <DialogTitle id="customized-dialog-title" onClose={handleClose}>
                    <b><center>{i18next.t('speechTask_explanation.header')}</center></b>
                </DialogTitle>
                <DialogContent dividers>
                    {navigationBarPrepare}
                    <Typography gutterBottom className="pb-3">
                        {i18next.t('speechTask_explanation.prepare')}
                    </Typography>
                    {navigationBarSpeak}
                    <Typography gutterBottom className="pb-3">
                        {i18next.t('speechTask_explanation.run')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button autoFocus onClick={handleClose} color="primary">
                        {i18next.t('speechTask_explanation.understood')}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
