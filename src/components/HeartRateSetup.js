import React from 'react';
import Button from '@material-ui/core/Button';
import i18next from 'i18next';
import {decodeHeartRateMeasurement} from '../heartRate';

export default class HeartRateSetup extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            connecting: false,
            error: null,
            notificationCount: 0,
            latestMeasurement: null,
        };
        this.device = null;
        this.onMeasurement = this.onMeasurement.bind(this);
        this.connect = this.connect.bind(this);
    }

    onMeasurement(event) {
        try {
            const receivedAtEpochMs = Date.now();
            const measurement = decodeHeartRateMeasurement(event.target.value, receivedAtEpochMs);
            this.setState(previous => ({
                notificationCount: previous.notificationCount + 1,
                latestMeasurement: {...measurement, receivedAtEpochMs},
            }));
            this.props.onMeasurement({...measurement, receivedAtEpochMs});
        } catch (error) {
            console.error('Could not decode heart-rate measurement', error);
        }
    }

    async connect() {
        this.setState({connecting: true, error: null});
        try {
            if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use a supported Chromium browser on HTTPS or localhost.');
            const device = await navigator.bluetooth.requestDevice({filters: [{services: ['heart_rate']}]});
            this.device = device;
            this.props.onDevice(device);
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService('heart_rate');
            const characteristic = await service.getCharacteristic('heart_rate_measurement');
            characteristic.addEventListener('characteristicvaluechanged', this.onMeasurement);
            await characteristic.startNotifications();
            this.props.onConnected(device.name || '(unnamed)');
        } catch (error) {
            if (this.device) {
                this.props.onDevice(null);
                this.device = null;
            }
            this.setState({error: `${error.name || 'Error'}: ${error.message}`});
        } finally {
            this.setState({connecting: false});
        }
    }

    render() {
        return <section className="container my-4" aria-labelledby="heart-rate-setup-title">
            <h2 id="heart-rate-setup-title">{i18next.t('heartRateDebug.title')}</h2>
            <p>{i18next.t('heartRateDebug.instructions')}</p>
            {this.state.error && <p role="alert" className="text-danger">{this.state.error}</p>}
            {this.props.connected && <p>Connected: {this.props.deviceName}</p>}
            <div className="alert alert-secondary text-left" role="status" aria-live="polite">
                <strong>{i18next.t('heartRateDebug.sensorData')}</strong>
                {this.state.notificationCount === 0
                    ? <div>{this.props.connected ? i18next.t('heartRateDebug.waitingForData') : i18next.t('heartRateDebug.noDataYet')}</div>
                    : <div>
                        <div>{i18next.t('heartRateDebug.notificationsReceived')}: {this.state.notificationCount}</div>
                        <div>{i18next.t('heartRateDebug.latestHeartRate')}: {this.state.latestMeasurement.bpm} bpm</div>
                        <div>{i18next.t('heartRateDebug.rrIntervals')}: {this.state.latestMeasurement.rrMs.length
                            ? this.state.latestMeasurement.rrMs.map(value => `${value.toFixed(1)} ms`).join(', ')
                            : i18next.t('heartRateDebug.rrNotPresent')}</div>
                        <div>{i18next.t('heartRateDebug.lastNotification')}: {new Date(this.state.latestMeasurement.receivedAtEpochMs).toLocaleTimeString()}</div>
                    </div>}
            </div>
            <Button variant="contained" className="alert-buttons" disabled={this.state.connecting || this.props.connected} onClick={this.connect}>
                {this.state.connecting ? i18next.t('heartRateDebug.connecting') : this.props.connected ? i18next.t('heartRateDebug.connected') : i18next.t('heartRateDebug.connect')}
            </Button>{' '}
            <Button variant="contained" className="alert-buttons" disabled={this.state.connecting} onClick={this.props.onContinue}>
                {this.props.connected ? i18next.t('heartRateDebug.continueConnected') : i18next.t('heartRateDebug.continueWithout')}
            </Button>
        </section>;
    }
}
