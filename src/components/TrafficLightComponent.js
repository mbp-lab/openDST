import React, { Component } from 'react';
import tl_green from '../img/TrafficLight_green.png';
import tl_yellow from '../img/TrafficLight_yellow.png';
import tl_red from '../img/TrafficLight_red.png';
import tl from '../img/TrafficLight.png';

class TrafficLightComponent extends Component {

    constructor(props) {
        super(props);
        this.componentHeight = 330/9
        this.componentWidth = 1000/9
        this.state = {
            color_state: 0, //this.props.color_state, // 0: no lighting, 1: green; 2: yellow; 3: red
            calibration_mode: this.props.calibration_mode, // saves the current mode; in calibration the results are better
            signal_given: true, // saves whether a signal is given so a light can be retuned
            random_mode: true,
            volume: this.props.volume
        };
        this.chooseImage = this.chooseImage.bind(this);
        this.chooseImageAfterDifferentTime = this.chooseImageAfterDifferentTime.bind(this);
    }

    componentDidMount() {
        this.interval = setInterval(() =>this.setState({color_state: this.chooseImageAfterDifferentTime()})
    , 100);
    }

    // this method should display random colors and change in 1/5 of the cases
    // it is used as an alternative for chooseImage()
    chooseImageAfterDifferentTime() {
        let show_color = 0; // the color that will be shown
        let nextImage = Math.floor(Math.random() * 4); // if this value is == 1 there will be shown a different color in the next step

        if (nextImage !== 1) {
            if (this.state.color_state === 0) {
                // the case is for changing the color at the beginning from 0 to 2
                show_color = 2;
            } else {
                // nothing is changing
                show_color = this.state.color_state
            }
        } else {

            if (this.props.signal_given === false) {
                if (this.state.color_state === 1) {
                    show_color = 2; // yellow
                } else {
                    show_color = 3; // red
                }
            } else if (this.state.calibration_mode) {
                if (this.state.color_state === 2) {
                    let tmp = Math.floor(Math.random() * 11);
                    if (tmp > 2) {
                        show_color = 1;
                    } else {
                        show_color = 3;
                    }
                } else {
                    // if the traffic light is green or red
                    show_color = 2;
                }
            } else {
                if (this.state.color_state === 2) {
                    let tmp = Math.floor(Math.random() * 11);
                    if (tmp > 9) {
                        show_color = 1;
                    } else {
                        show_color = 3;
                    }
                } else {
                    // if the traffic light is green or red
                    show_color = 2;
                }
            }

        }
        return show_color
    }

    componentWillUnmount() {
        clearInterval(this.interval);
    }

    chooseImage() {
        // variable for using different computation modes (see if case below)
        let color_number = 0
        if (this.state.random_mode) {
            color_number = Math.floor(Math.random() * 11); // number in range 0-10
        } else {
            color_number = this.props.volume;
        }

        // in calibration mode the traffic light will show better results (no red light for example)
        // to cause stress we will show more yellow and red in normal mode
        // if no signal is given the Traffic light will be red

        // if enough time passed since the last change
        let want_color = 0; // the scored color
        let show_color = 0; // the color that will be shown

        // choose the prefered color
        if (this.props.signal_given === false) {
            want_color = 3; // red
        } else if (this.state.calibration_mode) {
            if (color_number > 5) {

                want_color = 1; // green

            } else if (color_number > 2) {

                want_color = 2; // yellow

            } else {

                want_color = 3; // red

            }
        } else {
            if (color_number > 9) {

                want_color = 1; // green

            } else if(color_number > 7) {

                want_color = 2; // yellow

            } else {

                want_color = 3; // red

            }
        }

        // choose the color which will be shown
        if (want_color === 0) {
            show_color = 0;
        }
        else if (want_color === 1 && (this.state.color_state === 0 || this.state.color_state === 1 || this.state.color_state === 2)) {
            show_color = 1;
        }
        else if (want_color === 2 || (want_color === 1 && this.state.color_state === 3) || (want_color === 3 && this.state.color_state === 1) ) {
            show_color = 2;
        }
        else {
            show_color = 3;
        }
        return show_color
    }

    render() {
        if (this.state.color_state === 0) {
            return (
                <div>
                    <img src={tl} alt="Traffic Light" height={this.componentHeight} width={this.componentWidth}/>
                </div>
            )
        }
        else if (this.state.color_state === 1) {
            return (
                <div>
                    <img src={tl_green} alt="Green Traffic Light" height={this.componentHeight} width={this.componentWidth}/>
                </div>)
        }
        else if (this.state.color_state === 2) {
            return (
                <div>
                    <img src={tl_yellow} alt="Yellow Traffic Light" height={this.componentHeight} width={this.componentWidth}/>
                </div>)
        }
        else {
            return (
                <div>
                    <img src={tl_red} alt="Red Traffic Light" height={this.componentHeight} width={this.componentWidth}/>
                </div>)
        }
    }
}

export default TrafficLightComponent;