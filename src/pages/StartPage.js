import React from 'react';
import {Link} from "react-router-dom";
import i18next from "i18next";
import Button from "@material-ui/core/Button";
import hpi_logo from "../img/hpi_logo.jpg";
import techFak_logo from "../img/techFak.jpg";
import LanguageIcon from "@material-ui/icons/Language";
import {useMediaQuery} from "react-responsive";
import detectBrowserLanguage from "detect-browser-language";

export default class StartPage extends React.Component {
    constructor() {
        super();
        this.state = {
            language: 'de'
        }
        this.changeLanguage = this.changeLanguage.bind(this);
    }

    componentDidMount() {
        if (detectBrowserLanguage() === 'de-DE' || 'de') {
            i18next.changeLanguage('de').then(() => i18next.reloadResources());
            this.setState({language: 'de'})
        } else {
            i18next.changeLanguage('en').then(() => i18next.reloadResources());
            this.setState({language: 'en'})
        }
    }

    changeLanguage() {
        if (this.state.language === 'de') {
            i18next.changeLanguage('en').then(() => i18next.reloadResources())
            this.setState({
                language: 'en',
            })
        } else {
            i18next.changeLanguage('de').then(() => i18next.reloadResources())
            this.setState({
                language: 'de',
            })
        }
    }

    render() {
        let Desktop;
        let Mobile;
        if(process.env.REACT_APP_MOBILE_ONLY === 'true') {
            Desktop = ({children}) => {
                const isDesktop = useMediaQuery({minWidth: 992})
                return isDesktop ? children : null
            }
            Mobile = ({children}) => {
                const isMobile = useMediaQuery({maxWidth: 767})
                return isMobile ? children : null
            }
        } else {
            Mobile = ({children}) => {
                const isMobile = useMediaQuery({minWidth: 150})
                return isMobile ? children : null
            }
            Desktop = ({children}) => {
                const isDesktop = useMediaQuery({maxWidth: 50})
                return isDesktop ? null : null
            }
        }
        return (
            <>
                <Mobile>
                    <nav className="navbar navbar-expand-md navbar-dark bg-black fixed-top" id="mainNav">
                        <Link to="/stresstask" className="navbar-brand"> {i18next.t('startPage.navbar')}</Link>
                        <button className="navbar-button" onClick={this.changeLanguage}>
                            <LanguageIcon/> {i18next.t('startPage.language')}
                        </button>
                    </nav>
                    <section id="index-body">
                        <div className="container">
                            <div className="row justify-content-center text-center">
                                <h3 className="p-3">
                                    {i18next.t('startPage.header')}
                                </h3>
                            </div>
                            <div className="row index-middle-row text-center justify-content-center">
                                <div className="container-fluid">
                                    <div className="index-body-text1">
                                        {i18next.t('startPage.text1')}
                                    </div>
                                    <div className="font-italic index-body-title">
                                        "{i18next.t('startPage.title')}"
                                    </div>
                                </div>
                            </div>
                            <div className="row index-bottom-row text-center justify-content-center">
                                <div className="container-fluid">
                                    <div className="index-body-text2">
                                        {
                                            process.env.REACT_APP_LOGGING === "true"
                                            ? i18next.t('startPage.text2')
                                            : i18next.t('startPage.noLogging')
                                        }
                                    </div>
                                    <div className="p-2">
                                        <Button
                                            variant="contained"
                                            size="medium"
                                            className="alert-buttons"
                                            onClick={() => {
                                                this.props.updateStudyTracker(this.state.language);
                                                if(process.env.NODE_ENV !== "development" && process.env.REACT_APP_LOGGING === "true") {
                                                    let config = new Blob([`save_no_data\n${Date.now()}\n${jatos.studyProperties.title}\n${jatos.studyProperties.uuid}`], {type: 'text/plain'}); //eslint-disable-line no-undef
                                                    jatos.onLoad(function() {//eslint-disable-line no-undef
                                                        jatos.uploadResultFile(config, jatos.studyResultId + '_data_storage.txt')//eslint-disable-line no-undef
                                                    });
                                                    this.props.setStudyTimes('reference', Date.now());
                                                    this.props.uploadData('test_start', null);
                                                }
                                                window.scrollTo(0, 0);
                                                this.props.handleNext();
                                            }}
                                        >
                                            {i18next.t("startPage.button")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section id="imprint-partners">
                        <div className="container-fluid">
                            <div className="row justify-content-center">
                                <div className="col-12">
                                    <div className="text-center index-body-footer">
                                        {i18next.t('startPage.footer')}
                                    </div>
                                </div>
                            </div>
                            <div className="row justify-content-center pt-2 ">
                                <div className="col">
                                    <img className="mx-auto d-block index-logo-size" src={hpi_logo} alt={"hpi"}/>
                                </div>
                                <div className="col">
                                    <img className="mx-auto d-block index-logo-size" src={techFak_logo} alt={"techFak"}/>
                                </div>
                            </div>
                            <div className="row align-content-center footer-links">
                                <div className="col-6 text-center">
                                    <Link to="/dataProtection"> {i18next.t('dataProtection.header')}</Link>
                                </div>
                                <div className="col-6 text-center">
                                    <Link to="/imprint">{i18next.t('imprint.header')}</Link>
                                </div>
                            </div>
                        </div>
                    </section>
                </Mobile>
                <Desktop>
                    <nav className="navbar navbar-expand-md navbar-dark bg-black fixed-top" id="mainNav">
                        <Link to="/stresstask" className="navbar-brand"> {i18next.t('startPage.navbar')}</Link>
                        <button className="navbar-button" onClick={this.changeLanguage}>
                            <LanguageIcon/> {i18next.t('startPage.language')}
                        </button>
                    </nav>
                    <section id="index-body">
                        <div className="container">
                            <div className="row justify-content-center text-center">
                                <h3 className="p-3">
                                    {i18next.t('startPage.header')}
                                </h3>
                            </div>
                            <div className="row index-middle-row text-center justify-content-center">
                                <div className="container-fluid">
                                    <div className="index-body-text1">
                                        {i18next.t('startPage.text1')}
                                    </div>
                                    <div className="font-italic index-body-title">
                                        "{i18next.t('startPage.title')}"
                                    </div>
                                </div>
                            </div>
                            <div className="row index-bottom-row text-center justify-content-center">
                                <div className="container-fluid">
                                    <div className="stepper-header">
                                        {i18next.t('mobile-only')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section id="imprint-partners">
                        <div className="container-fluid">
                            <div className="row justify-content-center">
                                <div className="col-12">
                                    <div className="text-center index-body-footer">
                                        {i18next.t('startPage.footer')}
                                    </div>
                                </div>
                            </div>
                            <div className="row justify-content-center pt-2 ">
                                <div className="col">
                                    <img className="mx-auto d-block index-logo-size" src={hpi_logo} alt={"hpi"}/>
                                </div>
                                <div className="col">
                                    <img className="mx-auto d-block index-logo-size" src={techFak_logo} alt={"techFak"}/>
                                </div>
                            </div>
                            <div className="row align-content-center footer-links">
                                <div className="col-6 text-center">
                                    <Link to="/dataProtection"> {i18next.t('dataProtection.header')}</Link>
                                </div>
                                <div className="col-6 text-center">
                                    <Link to="/imprint">{i18next.t('imprint.header')}</Link>
                                </div>
                            </div>
                        </div>
                    </section>
                </Desktop>
            </>
        )
    }
}