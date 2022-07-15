import React from 'react';


const bgDefault = ' bgDefault number-button';

class NumberInputField extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            buttonState: bgDefault,
            buttonStack: [],
        };
    }

    componentDidMount() {
        this.setNumberPad(this.props.numberInputLayoutIsRandom);
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (this.props.numberInputLayoutIsRandom !== prevProps.numberInputLayoutIsRandom) {
            this.setNumberPad(this.props.numberInputLayoutIsRandom);
        }
    }

    setNumberPad(numberInputLayoutIsRandom) {
        let buttonStackInit = [];
        if (numberInputLayoutIsRandom === false) {
            this.setState({buttonStack: [1,2,3,4,5,6,7,8,9,0]})
        } else {
            while (buttonStackInit.length < 10) {
                const random = Math.round(Math.random() * 9)
                if (buttonStackInit.includes(random)) {
                    continue;
                } else {
                    buttonStackInit.push(random)
                }
            }
            this.setState({buttonStack: buttonStackInit})
        }
    }

    render() {
        return (
            <div className='container'>
                <div className='row align-items-end text-center'>
                    <div className='col-md-12'>
                        <div className='row'>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[0]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[0]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[1]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[1]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[2]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[2]}
                                </button>
                            </div>
                        </div>
                        <div className='row'>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[3]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[3]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[4]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[4]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[5]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[5]}
                                </button>
                            </div>
                        </div>
                        <div className='row'>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[6]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[6]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[7]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[7]}
                                </button>
                            </div>
                            <div className='col-4 p-1'>
                                <button type="button" id={this.state.buttonStack[8]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[8]}
                                </button>
                            </div>
                        </div>
                        <div className='row justify-content-end'>
                            <div className='col-12 p-1'>
                                <button type="button" id={this.state.buttonStack[9]} className={this.state.buttonState}
                                        onClick={this.props.handleNumberInput}
                                        disabled= {this.props.isDisabled}
                                >{this.state.buttonStack[9]}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
export default NumberInputField;