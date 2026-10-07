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
* **/.env**: Contains environment variables where logging, video-recording, mobile-only and URLs for the app can be configured. Set `REACT_APP_MOBILE_ONLY=true` to require a mobile device. This checkout sets it to false; use a mobile viewport when testing the intended mobile layout.


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
When unset, ordinary video upload and study-result logging are disabled. The tracked `.env` in this checkout explicitly enables recording, logging, facecrop and debugging; review it before building. For a run without uploads, set `REACT_APP_LOGGING=false`, `REACT_APP_VIDEO_RECORDING=false`, and `REACT_APP_FACE_CROP_RECORDING_MODE=off`. We developed a dedicated data security concept for collecting data and storing it. Please [contact us](https://www.uni-bielefeld.de/fakultaeten/technische-fakultaet/arbeitsgruppen/multimodal-behavior-processing/index.xml) for further information.
 
<i>Please note: If video recording or data logging are enabled the data privacy statement has to be adapted.</i>


**Known limitation:** The ordinary `MediaRecorder` MP4/WebM path does not safely
support repeated recordings within one mounted `WebcamCapture` instance. It reuses
the chunk buffer and filename, so a later recording can include prior chunks and
overwrite the earlier upload. This is unrelated to face-crop capture.

# General Info on React

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## For comprehensive guide see:

* [DOCUMENTATION.md](DOCUMENTATION.md)



## Available Scripts

In the project directory, you can run:

### Facecrop setup

Use Node 22.x/npm 10.x. Install the frontend dependencies, then use the app-owned preparation command after a clean checkout or after changing facecrop source:

```sh
git submodule update --init --recursive
npm ci
npm run facecrop:prepare
```

The reusable library lives in the [`browser-facecrop/` submodule](browser-facecrop/README.md). Historical study campaign evidence is preserved in [docs/facecrop-history/](docs/facecrop-history/README.md).

The preparation command installs facecrop's locked dependencies, builds and validates its browser distribution, and stages it for this app. `npm start`, `npm test`, and `npm run build` use the last staged distribution. `npm run build:study` prepares facecrop and then builds the app.

The study adapter owns openDST's environment settings, task selection, context, filename convention, and upload gate. Capture lifecycle belongs to the library; upload tracking consumes its artifact events. The library's optional React hook is available for functional consumers, while this app keeps its existing component integration.

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
