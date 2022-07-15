import React from "react";
import Countdown from "react-countdown";
import TimerIcon from "@material-ui/icons/Timer";

const Completionist = () => <span className="speechTask-countdown ">?</span>;

const renderer = ({ seconds, milliseconds, completed }) => {
    if (completed) {
        return <Completionist/>;
    } else {
        return (
            <span className="speechTask-countdown ">
            {seconds}:{milliseconds}
        </span>
        );
    }
};

export default function CountdownSpeechTask(props) {
    return (
        <>
            <TimerIcon fontSize={'large'}/>
            <Countdown
                date={props.remainingMilliseconds}
                key={props.speechTaskStateCounter}
                intervalDelay={0}
                precision={3}
                controlled={true}
                renderer={renderer}
                autoStart={true}
            />
        </>
    )
}