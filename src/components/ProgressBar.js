import React  from 'react';
import {withStyles, lighten} from "@material-ui/core/styles";
import LinearProgress from '@material-ui/core/LinearProgress';


const BorderLinearProgress = withStyles({
    root: {
        height: 20,
        backgroundColor: lighten('#ff0000', 0.9),
        width: '100%',
    },
    bar: {
        borderRadius: 20,
        backgroundColor: 'red',
        transition: 'none',
        transform: [{ rotate: '180deg'}],
        width: '100%'
    },
})(LinearProgress);

export default class Progressbar extends React.Component {
    constructor(props) {
        super(props);
        this.inverseNumber = this.inverseNumber.bind(this)
    }

    inverseNumber(inverseNumber) {
        let number = inverseNumber - 100;
        return Math.abs(number);
    }

    render() {
        let value = this.inverseNumber(this.props.questionCurrentInPercentage);
        return <div className="row align-items-center">
                <div className="col-md-auto justify-content-center">
                    <div className="question-timer">
                        <BorderLinearProgress
                            className="my-2 rounded"
                            variant="determinate"
                            value={value}
                        />
                    </div>
                </div>
            </div>
    }
}
