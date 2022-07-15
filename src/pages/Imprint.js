import i18next from "i18next";
import hpi_logo from "../img/hpi_logo.jpg";
import techFak_logo from "../img/techFak.jpg";
import React from "react";
import { Link } from 'react-router-dom';

class DataPrivacy extends React.Component {
    render() {
        return (
            <div className="App">
                <nav className="navbar navbar-expand-md navbar-dark bg-black fixed-top" id="mainNav">
                    <Link to="/stresstask" className="navbar-brand"> {i18next.t('startPage.navbar')}</Link>
                </nav>
                <section id="imprint-body">
                    <div className="container">
                        <div className="row justify-content-center ">
                            <h3 className="imprint-header">
                                {i18next.t('imprint.header')}
                            </h3>
                        </div>
                        <div className="row mt-2">
                            <div className="container-fluid">
                                <div className="imprint-body-header" >
                                    {i18next.t('imprint.institute.header')}
                                </div>
                                <div className="imprint-body">
                                    {i18next.t('imprint.institute.street')}
                                    <br />
                                    {i18next.t('imprint.institute.town')}
                                    <br />
                                    {i18next.t('imprint.institute.phone')}
                                    <br />
                                    {i18next.t('imprint.institute.fax')}
                                    <br />
                                    {i18next.t('imprint.institute.mail')}
                                    <br />
                                    {i18next.t('imprint.institute.website')}
                                </div>
                            </div>
                        </div>
                        <div className="row mt-2">
                            <div className="container-fluid">
                                <div className="imprint-body-header" >
                                    {i18next.t('imprint.director.header')}
                                </div>
                                <div className="imprint-body">
                                    {i18next.t('imprint.director.name')}
                                    <br />
                                    {i18next.t('imprint.director.office')}
                                    <br />
                                    {i18next.t('imprint.director.number')}
                                    <br />
                                    {i18next.t('imprint.director.person')}
                                </div>
                            </div>
                        </div>
                        <div className="row mt-2">
                            <div className="container-fluid">
                                <div className="imprint-body-header" >
                                    {i18next.t('imprint.legal.header')}
                                </div>
                                <div className="imprint-body">
                                    {i18next.t('imprint.legal.body')}
                                </div>
                            </div>
                        </div>
                        <div className="row mt-2">
                            <div className="container-fluid">
                                {i18next.t('dataProtection.version')}
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
                                <img className="mx-auto d-block index-logo-size" src={hpi_logo}  alt={"hpi"}/>
                            </div>
                            <div className="col">
                                <img className="mx-auto d-block index-logo-size" src={techFak_logo}  alt={"techFak"}/>
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
                <footer>
                    <div className="container">
                    </div>
                </footer>
            </div>
        )
    }
}
export default DataPrivacy;
