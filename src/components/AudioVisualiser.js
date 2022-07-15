import React, { Component } from 'react';

//https://www.twilio.com/blog/audio-visualisation-web-audio-api--react
class AudioVisualiser extends Component {
    constructor(props) {
        super(props);
        this.canvasRef = React.createRef();
    }

    componentDidUpdate() {
        this.draw();
    }


    draw() {
        const { audioData } = this.props;
        const canvas = this.canvasRef.current;
        const height = canvas.height;
        const width = canvas.width;
        const context = canvas.getContext('2d');
        let x = 0;
        //
        const sliceWidth = (width * 1.0) / audioData.length;

        context.lineWidth = 2;
        context.strokeStyle = '#000000';
        context.clearRect(0, 0, width, height);

        context.beginPath();
        context.moveTo(0, height / 2);
        for (const item of audioData) {
            const y = (item / 255.0) * height;
            context.lineTo(x, y);
            x += sliceWidth;
        }
        context.lineTo(x, height / 2);
        context.stroke();
    }

    render() {
        return (
            <div>
                <canvas width={this.props.width} height={this.props.height} ref={this.canvasRef} />

            </div>
        )
    }
}

export default AudioVisualiser;