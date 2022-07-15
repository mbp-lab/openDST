import React from "react";
import i18next from 'i18next';

class TaskFrame extends React.Component {
    render() {
        switch (this.props.currentFeedback) {
            case 'wrong':
                return (
                    <div className="row math-component d-flex py-2 px-1 border-question align-items-center">
                        <div className="col-12 p-0 text-center time-overflow">
                            {i18next.t('task_frame.wrong')}
                        </div>
                    </div>
                );
            case 'missingInteraction':
            case 'slow':
                return (
                    <div className="row math-component d-flex py-2 px-1 border-question align-items-center">
                        <div className="col-12 p-0 text-center time-overflow">
                            {i18next.t('task_frame.slow')}
                        </div>
                    </div>
                );
            default:
                let oneDigit = this.props.currentQuestion.answer <= 9;
                return (
                    <div className="row math-component d-flex">
                        <input
                            className="col-6 p-0 text-center"
                            id="math-question"
                            value={this.props.currentQuestion.question}
                            readOnly
                        />
                        <input
                            className="col-1 p-0 text-center"
                            id="math-equals"
                            value={"="}
                            readOnly
                        />
                        <div className="mx-2"/>
                        <div id={(oneDigit ? 'math-answer-one-digit' : 'math-answer-two-digit')}>
                            {this.props.currentNumberInput}
                        </div>
                    </div>
                )
        }
    }
}

export default TaskFrame;
