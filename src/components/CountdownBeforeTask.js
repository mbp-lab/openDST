import React from "react";
import i18next from "i18next";
import Button from "@material-ui/core/Button";

export default class CountdownBeforeTask extends React.Component {
    constructor() {
        super();
        this.state = {
            countdownTimer: 3,
            showStartButton: true,
        }
    }

    render() {
        return (
            <div>
                { this.state.showStartButton
                    ? <div className="countdown-centered-button">
                        <Button
                            variant="contained"
                            size="large"
                            className="speechTask-countdown-button"
                            onClick={() => {
                                this.setState({
                                    showStartButton: false,
                                })
                                let countdown = setInterval(
                                    () => {
                                        this.setState({
                                            countdownTimer: this.state.countdownTimer - 1,
                                        })
                                    }, 1000)
                                setTimeout(() => {
                                    clearInterval(countdown)
                                    this.props.startTask();
                                }, 3000)
                            }}>
                            {i18next.t('button.start')}
                        </Button>
                    </div>
                    : <div className="countdown-centered-number">
                        <div className="text-center countdown">
                            {this.state.countdownTimer}
                        </div>
                    </div>
                }
            </div>
        );
    }
}