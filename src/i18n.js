import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';


import translationEn from './locales/en/translation.json'
import translationDe from './locales/de/translation.json'

//import Backend from 'i18next-http-backend';
//import LanguageDetector from 'i18next-browser-languagedetector';
// not like to use this?
// have a look at the Quick start guide
// for passing in lng and translations on init


i18n
    // load translation using http -> see /public/locales (i.e. 1
    // learn more: https://github.com/i18next/i18next-http-backend
   // .use(Backend)
    // detect user language
    // learn more: https://github.com/i18next/i18next-browser-languageDetector
  //  .use(LanguageDetector)
    // pass the i18n instance to react-i18next.
    .use(initReactI18next)
    // init i18next
    // for all options read: https://www.i18next.com/overview/configuration-options
    .init({
        debug: true,
        fallbackLng: "en",
        resources: {
            en: {
                translation: translationEn
            },
            de: {
                translation: translationDe
            }
        },
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        }
    });


export default i18n;