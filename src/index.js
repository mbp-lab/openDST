import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import 'bootstrap/dist/css/bootstrap.css';
import './home.css'
import './stresstask.css'
import './imprint.css'
import './i18n';
import {installConsoleLogCapture} from './consoleLog';

installConsoleLogCapture();

// Wait until legacy service workers and their Cache Storage are removed.
Promise.resolve(window.__openDstCacheCleanup).then(({reloadRequired} = {}) => {
  if (reloadRequired) {
    window.location.reload();
    return;
  }
  ReactDOM.render(
      <App />,
    document.getElementById("root")
  );
});
