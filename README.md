# Digital Stress Test

The Digital Stress Test is created with the JavaScript framework React.js in combination with [JATOS](https://www.jatos.org/) as a backend for study management. The app was setup, built and configured using the "create react app" toolchain. This includes the package manager npm, the bundler webpack and the compiler babel. For detailed introduction and alternatives see below or visit [reactjs.org](https://reactjs.org/).

The Digital Stress Test was developed in conjunction with [this paper](https://dx.doi.org/10.2196/32280). Since publication of the paper the following changes haven been made to the app:
* A cancel button was added
* "faked" feedback during the speech task with a traffic light component
* wordings for video storage possibility
* logging updates

A presentation variant based on this code in which no data is logged can be accessed [here](https://resilience.tf.uni-bielefeld.de/publix/39/start?batchId=39&generalMultiple).

<i>Please note: Before using the Digital Stress Test in a study, please [contact us](https://www.uni-bielefeld.de/fakultaeten/technische-fakultaet/arbeitsgruppen/multimodal-behavior-processing/index.xml).</i>

## Source Code

The web app is written as a single-page application using React.js. The Main.js component is where most of the state relevant for the study logic resides. Also the data is collected there. 


### Project Structure:
* **/src/Main.js**: This is the central component where the study state (which components are to be rendered) and data (task times, means, loggings, default language, ...) is located.
* **/src/pages/**: Contains the pages out of which the study is composed. They are basically children of the Main component.
* **/src/components/**: Contains the reusable components which are used in the different pages components.
* **/src/img/**: Contains logos and the images for the TrafficLight component.
* **/src/locales/**: Contains the locale files for the different translations of the app. Internationalization is managed through the i18n-module.
* **/.env**: Contains environment variables where logging, video-recording, mobile-only and URLs for the app can be configured. <i>Note: mobile-only is enabled as default and the non-mobile layout for the DST is not developed yet. If you want to view the DST on a desktop computer you have to use the mobile mode of your browser.</i>


### Render Logic:

The Main.js component conditionally renders its children based on 8 different study states: 'startPage', 'introduction', 'mathTaskTutorial', 'mathTask', 'mathTaskResult', 'speechTaskTutorial', 'speechTask', 'endPage'.

These study states correspond to components of the same name, which are called pages in the context of this app. The sequence in which those pages are ordered in the study flow is specified in an array named studyPagesSequence in Main.js

Each page can consist of several slides which are specified in the slideSequences-object in Main.js.

During the study flow the variables pageIndex and slideIndex in Main.js are incremented to render the components of the app.

## JATOS
*	JATOS can be used as a backend solution, to store files (temporarily) and manage online studies. 
*	JATOS is installed on the study web-server
*	studies can be hosted in the GUI where every new project needs a new "study-asset-root" directory in JATOS 
*	in this directory, the built project must be placed
 
## Video recording and data upload/storage
Per default video recording and data logging are disabled in the .env-file. We developed a dedicated data security concept for collecting data and storing it. Please [contact us](https://www.uni-bielefeld.de/fakultaeten/technische-fakultaet/arbeitsgruppen/multimodal-behavior-processing/index.xml) for further information.
 
<i>Please note: If video recording or data logging are enabled the data privacy statement has to be adapted.</i>

# General Info on React

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.<br />
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br />
You will also see any lint errors in the console.

### `npm run build`

Builds the app for production to the `build` folder.<br />
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br />
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

