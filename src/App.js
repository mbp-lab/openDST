import React, {Component, } from 'react';
import {HashRouter, Route, Switch} from 'react-router-dom'
import Main from './Main';
import Error from './Error';
import DataProtection from './pages/DataProtection'
import Imprint from './pages/Imprint'

const ScrollToTop = () => {
    window.scrollTo(0, 0);
    return null;
};
class App extends Component {
    render() {
        return (
            <HashRouter>
                <div>
                    <Route component={ScrollToTop} />
                    <Switch>
                        <Route path="/" component={Main} exact/>
                        <Route path="/stresstask" component={Main} exact/>
                        <Route path="/dataProtection" component={DataProtection} exact/>
                        <Route path="/imprint" component={Imprint} exact/>
                        <Route component={Error}/>
                    </Switch>
                </div>
            </HashRouter>
        )
    }
}
export default App;
