import React from 'react';
import {HorizontalBar} from 'react-chartjs-2';
import i18next from "i18next";

class FeedbackChart extends React.Component {

    render() {
        return (
            <HorizontalBar
                data={
                    {
                        labels: [i18next.t('feedback_graph.average'), i18next.t('feedback_graph.you')],
                        datasets: [
                            {
                                label: ['Current in %'],
                                fill: false,
                                lineTension: 0.5,
                                backgroundColor: ['#0d47a1', '#90caf9'],
                                data: [this.props.averageScore, this.props.userScore]
                            }]
                    }}
                options={{
                    animation: {duration:1000},
                    title: {
                        display: false,
                        text: 'Your score compaired to other users: ',
                        fontSize: 15,
                        fontColor: 'black',
                        position: 'top'
                    },
                    layout: {
                        padding: 0
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: ['this', 'that']
                    },
                    maintainAspectRatio: false,
                    scales: {
                        xAxes: [{
                            scaleLabel: {
                                display: true,
                                labelString: i18next.t('feedback_graph.label')
                            },
                            ticks: {
                                beginAtZero: true,
                                max: 100,
                                display: true,
                                stepSize: 10,
                                steps: 10
                            }
                        }]
                    }

                }}
                height={this.props.height}
            />
        );
    }

}

export default FeedbackChart;
