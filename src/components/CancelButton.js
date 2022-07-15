import React from 'react';
import Button from "@material-ui/core/Button";
import i18next from "i18next";

export class CancelButton extends React.Component {
    render() {
        return (
            <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={() => this.props.handleCancelDialog()}>
                {i18next.t('button.cancel')}
            </Button>
        );
    }
}