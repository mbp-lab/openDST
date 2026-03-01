# OpenDST — Digital Stress Test Documentation

A guide to use the [Digital Stress Test (DST)](https://github.com/mbp-lab/openDST) in their studies. The DST is an open-source React.js web application that induces psychosocial stress online.

**Publication:** Norden, M., Hofmann, A. G., Meier, M., Balzer, F., Wolf, O. T., Böttinger, E., & Drimalla, H. (2022). Inducing and Recording Acute Stress Responses on a Large Scale With the Digital Stress Test (DST): Development and Evaluation Study. *Journal of Medical Internet Research*, 24(7), e32280. https://doi.org/10.2196/32280

**Repository:** https://github.com/mbp-lab/openDST

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Study Flow Overview](#2-study-flow-overview)
3. [Configuration Reference](#3-configuration-reference)
4. [Customization Guide](#4-customization-guide)
5. [Architecture and Code Reference](#5-architecture-and-code-reference)
6. [Data Collection and Output](#6-data-collection-and-output)
7. [Deployment](#7-deployment)
8. [Troubleshooting and FAQ](#8-troubleshooting-and-faq)

---

## 1. Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v16.x
- npm (comes with Node.js)
- [Docker](https://docs.docker.com/get-docker/) (for JATOS deployment)
- A web server with a public domain (for production)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/mbp-lab/openDST.git
cd openDST

# 2. Install dependencies
npm install

# 3. Configure environment variables (see Section 3)
#    Edit .env to match your setup

# 4. Run locally for testing
npm start
#    Opens http://localhost:3000 in your browser
#    Use browser dev tools to enable mobile view (the app is mobile-only by default)

# 5. Build for production
npm run build
#    Creates an optimized bundle in the build/ folder

# 6. Deploy to JATOS (see Section 7 for full details)
#    Copy the build folder contents into your JATOS study assets directory
```

> **Tip:** A demo version without data collection is available for testing. Keep `REACT_APP_LOGGING` set to `'false'` and `REACT_APP_VIDEO_RECORDING` set to `'false'` in `.env` to run the DST without storing any participant data.

---

## 2. Study Flow Overview

The DST presents participants with a sequence of screens that combine cognitive and verbal stress induction tasks. The entire procedure takes approximately 10 minutes.

### Participant Experience

```
Start Page
    │
    ▼
Introduction
    ├── Study information (2 slides)
    ├── Consent form (checkbox-based)
    ├── Baseline VAS (Visual Analogue Scale)
    ├── Baseline PANAS (mood questionnaire)
    └── Webcam calibration
    │
    ▼
Math Task Tutorial
    ├── Instructions
    ├── Gender and age form (for "comparison group" — faked)
    └── Countdown
    │
    ▼
Math Task (90 seconds)
    │   Adaptive arithmetic with live performance chart
    │   Webcam recording (if enabled)
    │
    ▼
Math Task Result
    │   Score shown vs. faked 75% average
    │
    ▼
Speech Task Tutorial
    ├── Intermediate VAS
    ├── Transition screen ("End of Part 1")
    └── Instructions for speech task
    │
    ▼
Speech Task
    │   3 questions (10s preparation + 20s answer each)
    │   Traffic light feedback, audio visualization
    │   Webcam recording (if enabled)
    │
    ▼
End Page
    ├── Final VAS
    ├── Final PANAS
    ├── Debriefing (reveals deceptions)
    └── Speech analysis results + redirect to survey
```

---

## 3. Configuration Reference

All configuration is done through the `.env` file in the project root. Changes require a rebuild (`npm run build`).

### Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PUBLIC_URL` | String | `/study_assets/digital-stress-test-published` | The URL path where the built app is served. **Must match** the name of your JATOS study assets folder. |
| `REACT_APP_MOBILE_ONLY` | `'true'` / `'false'` | `'true'` | When `'true'`, displays a "please use your smartphone" message on desktop browsers. Participants must use a mobile device. For desktop testing, use browser developer tools to simulate a mobile viewport. |
| `REACT_APP_VIDEO_RECORDING` | `'true'` / `'false'` | `'false'` | Enables webcam video recording during calibration, math task, and speech task. Videos are uploaded to the JATOS backend. **Requires `REACT_APP_LOGGING` to also be `'true'`.** |
| `REACT_APP_LOGGING` | `'true'` / `'false'` | `'false'` | Master switch for all data persistence. When `'false'`, no participant data is saved to JATOS. This includes JSON result files and video recordings. |
| `REACT_APP_SURVEY_HOST_PATH` | URL string | `'https://www.soscisurvey.de/resilience2021/'` | Base URL for the post-study survey. Participants are redirected here after completing the DST. The participant ID and JATOS result ID are appended as query parameters. Set to `''` to disable redirect. |
| `REACT_APP_DEBRIEFING_HOST_PATH` | URL string | `'https://resilience.tf.uni-bielefeld.de/debriefing/'` | URL for the debriefing page shown when a participant cancels the study. Set to `''` to disable. |
| `REACT_APP_ADDITIONAL_INFORMATION_URL_DE` | URL string | `'some_url'` | URL to an additional information document linked in the consent slide (German version). |
| `REACT_APP_ADDITIONAL_INFORMATION_URL_EN` | URL string | `'some_url'` | URL to an additional information document linked in the consent slide (English version). |

### Example `.env` for a Live Study

```env
PUBLIC_URL=/study_assets/my-dst-study
REACT_APP_MOBILE_ONLY = 'true'
REACT_APP_VIDEO_RECORDING = 'true'
REACT_APP_LOGGING = 'true'
REACT_APP_SURVEY_HOST_PATH = 'https://your-survey-platform.com/your-survey/'
REACT_APP_DEBRIEFING_HOST_PATH = 'https://your-institution.edu/debriefing/'
REACT_APP_ADDITIONAL_INFORMATION_URL_DE = 'https://your-institution.edu/info-de.pdf'
REACT_APP_ADDITIONAL_INFORMATION_URL_EN = 'https://your-institution.edu/info-en.pdf'
```

### Example `.env` for Local Testing (No Data Collection)

```env
PUBLIC_URL=/study_assets/digital-stress-test-published
REACT_APP_MOBILE_ONLY = 'false'
REACT_APP_VIDEO_RECORDING = 'false'
REACT_APP_LOGGING = 'false'
REACT_APP_SURVEY_HOST_PATH = ''
REACT_APP_DEBRIEFING_HOST_PATH = ''
REACT_APP_ADDITIONAL_INFORMATION_URL_DE = ''
REACT_APP_ADDITIONAL_INFORMATION_URL_EN = ''
```

### Study Flow Configuration

The study flow is controlled by two arrays in `src/Main.js`:

**`studyPagesSequence`** — defines the order of major pages:

```javascript
['startPage', 'introduction', 'mathTaskTutorial', 'mathTask',
 'mathTaskResult', 'speechTaskTutorial', 'speechTask', 'endPage']
```

**`slideSequences`** — defines the slides within each page:

```javascript
{
    startPage:          ['startPage'],
    introduction:       ['intro', 'consent', 'vas', 'panas', 'calibration'],
    mathTaskTutorial:   ['intro', 'comparison', 'countdown'],
    mathTask:           ['mathTask'],
    mathTaskResult:     ['mathTaskResult'],
    speechTaskTutorial: ['vas', 'transition', 'intro'],
    speechTask:         ['speechTask'],
    endPage:            ['vas', 'panas', 'explanation', 'questionnaire'],
}
```

To remove a page or slide, comment it out or remove it from the array. For example, to skip the consent form:

```javascript
introduction: ['intro', /* 'consent', */ 'vas', 'panas', 'calibration'],
```

See [Section 4](#4-customization-guide) for detailed customization instructions.

---

## 4. Customization Guide

### Adding a New Language

The DST with English (`en`) and German (`de`). Translations are stored in `src/locales/{language_code}/translation.json`.

**NOTE** - Please consider contributing by adding language translations.


**Step 1: Create the translation file**

Copy an existing translation file as a template:

Edit the new file and translate all values (keep the keys unchanged):

```json
{
  "startPage": {
    "welcome": "Bienvenue au test de stress numérique",
    ...
  }
}
```

The translation file contains keys for every piece of text in the application. The main sections are:

| Key Prefix | Content |
|---|---|
| `startPage.*` | Welcome page text, participant ID label |
| `study_introduction_1.*`, `study_introduction_3.*` | Study information and privacy slides |
| `vas.*`, `vas_questions.*` | Visual Analogue Scale headers and question labels |
| `panas.*` | PANAS questionnaire items and scale labels |
| `mathTask.*`, `example.*` | Math task instructions and feedback messages |
| `speechTaskTutorial.*`, `speechTask.*` | Speech task instructions and questions |
| `transition.*` | Transition screen between tasks |
| `end.*` | End page: debriefing text, explanation, questionnaire labels |
| `stepper.*` | Progress stepper labels |
| `cancelDialog.*`, `alertAbortStudy.*` | Cancellation dialog text |
| `mediaTesting.*` | Webcam calibration flow text |
| `genderAndAge.*` | Gender and age form labels |
| `dataProtection.*`, `imprint.*` | Legal pages |
| `feedback_graph.*` | Math task performance chart labels |
| `audioAnalyzing.*` | Speech task audio prompts |

**Step 2: Register the language in `src/i18n.js`**

```javascript
import translationEn from './locales/en/translation.json'
import translationDe from './locales/de/translation.json'
import translationFr from './locales/fr/translation.json'  // Add import

i18n
    .use(initReactI18next)
    .init({
        debug: true,
        fallbackLng: "en",
        resources: {
            en: { translation: translationEn },
            de: { translation: translationDe },
            fr: { translation: translationFr },  // Add resource
        },
        interpolation: { escapeValue: false }
    });
```

**Step 3: Add language selection UI (optional)**

The default openDST does not include a language selection dropdown. To add one, you would need to modify the `Navbar` component in `src/components/Navbar.js` to include a language switcher that calls `i18n.changeLanguage('fr')`.

**Step 4: Set the default language (optional)**

To force a specific language instead of the English fallback, add the `lng` option:

```javascript
i18n
    .use(initReactI18next)
    .init({
        debug: true,
        lng: "fr",           // Forces French as default
        fallbackLng: "en",
        resources: { ... },
    });
```

### Modifying the Study Flow

You can remove entire pages or individual slides by editing the arrays in `src/Main.js`.

**Remove the speech task entirely:**

```javascript
studyPagesSequence: [
    'startPage', 'introduction', 'mathTaskTutorial', 'mathTask',
    'mathTaskResult', /* 'speechTaskTutorial', 'speechTask', */ 'endPage'
],
```

Also remove the speech-related slides from the end page if they reference speech data:

```javascript
endPage: ['vas', 'panas', 'explanation'],  // removed 'questionnaire' (speech analysis)
```

**Remove the math task entirely:**

```javascript
studyPagesSequence: [
    'startPage', 'introduction', /* 'mathTaskTutorial', 'mathTask',
    'mathTaskResult', */ 'speechTaskTutorial', 'speechTask', 'endPage'
],
```

**Remove webcam calibration:**

```javascript
introduction: ['intro', 'consent', 'vas', 'panas'],  // removed 'calibration'
```

**Remove the consent form:**

```javascript
introduction: ['intro', /* 'consent', */ 'vas', 'panas', 'calibration'],
```

> **Note:** If you remove the consent form from the app, ensure informed consent is obtained through another mechanism (e.g., an external survey platform before redirecting to the DST).

### Changing Speech Task Questions

The three speech task questions are defined in the translation files under `speechTask.question_1`, `speechTask.question_2`, and `speechTask.question_3`. To change them, edit the translation JSON:

```json
{
  "speechTask": {
    "question_1": "Describe a situation where you were heavily criticized.",
    "question_2": "What are your biggest weaknesses?",
    "question_3": "What does betrayal mean to you and can you give an example?"
  }
}
```

Replace the values with your own questions. Remember to update all language files.

### Adjusting Math Task Difficulty

The math task adaptive algorithm is implemented in `src/pages/MathTask.js`.

To modify, edit the relevant constants and logic.

### Changing VAS (Visual Analogue Scale) Items

The VAS is rendered by `src/components/VisualAnalogueScale.js`. The slider labels come from the translation file under `vas_questions.*`. To change the questions:

1. Edit the translation JSON to modify the question labels
2. If you need to add or remove sliders, modify the `VisualAnalogueScale` component and update the `vasFeedback` data structure in `Main.js`

### Changing PANAS Items

The PANAS questionnaire is rendered by `src/components/Panas.js`. Items and scale labels come from the translation file under `panas.*`. To modify:

1. Edit the translation JSON to change item labels or scale points
2. If changing the number of items, update the `Panas` component and the `panasFeedback` data structure in `Main.js`

### Cancel Dialog Options

The cancel dialog (`src/components/CancelDialog.js`) offers participants options when they want to stop:

- Cancel and submit no data
- Cancel but submit data without video
- Cancel and submit all data (including video)
- Do not cancel (continue the study)

To modify which options are available, edit the radio button options in `CancelDialog.js`.

---

## 5. Architecture and Code Reference

### Technology Stack

| Layer | Technology | Version |
|---|---|---|
| UI Framework | React.js | 16.x |
| Routing | react-router-dom (HashRouter) | 5.3.3 |
| UI Components | Material UI | 4.x |
| CSS Framework | Bootstrap | 4.6.1 |
| Charts | Chart.js + react-chartjs-2 | 2.9.3 / 2.x |
| Webcam | react-webcam | 5.2.4 |
| Internationalization | i18next + react-i18next | 19.x / 11.x |
| Countdown Timers | react-countdown | 2.3.2 |
| Device Detection | react-responsive, ua-parser-js | 8.2.0 / 1.x |
| Build Toolchain | Create React App (react-scripts) | 3.4.3 |
| Backend | JATOS | latest |

### Project Structure

```
openDST/
├── .env                        # Environment configuration
├── package.json                # Dependencies and scripts
├── public/
│   ├── index.html              # HTML entry point
│   ├── manifest.json           # PWA manifest
│   └── robots.txt
├── src/
│   ├── index.js                # React entry point, renders App
│   ├── App.js                  # Router setup (HashRouter)
│   ├── Main.js                 # Central controller — ALL study state and data
│   ├── Error.js                # 404 error page
│   ├── i18n.js                 # Internationalization config (en, de)
│   ├── utils.js                # Utility functions
│   ├── serviceWorker.js        # Service worker (CRA default)
│   ├── home.css                # Start page styles
│   ├── stresstask.css          # Task page styles
│   ├── imprint.css             # Imprint page styles
│   ├── locales/
│   │   ├── en/translation.json # English translations
│   │   └── de/translation.json # German translations
│   ├── img/
│   │   ├── hpi_logo.jpg        # HPI logo
│   │   ├── techFak.jpg         # TechFak logo
│   │   ├── TrafficLightGreen.png
│   │   ├── TrafficLightRed.png
│   │   ├── TrafficLightYellow.png
│   │   └── TrafficLightOff.png
│   ├── pages/                  # Full-screen page components
│   │   ├── StartPage.js
│   │   ├── Introduction.js
│   │   ├── MathTaskTutorial.js
│   │   ├── MathTask.js
│   │   ├── MathTaskResult.js
│   │   ├── SpeechTaskTutorial.js
│   │   ├── SpeechTask.js
│   │   ├── EndPage.js
│   │   ├── DataProtection.js
│   │   └── Imprint.js
│   └── components/             # Reusable UI components
│       ├── Navbar.js
│       ├── FooterAndLogos.js
│       ├── StepperWithLabels.js
│       ├── VisualAnalogueScale.js
│       ├── Panas.js
│       ├── Calibration.js
│       ├── WebcamCapture.js
│       ├── AudioAnalyser.js
│       ├── AudioVisualiser.js
│       ├── CancelDialog.js
│       ├── CancelButton.js
│       ├── AbortDialog.js
│       ├── Redirection.js
│       ├── TaskFrame.js
│       ├── NumberInputField.js
│       ├── ProgressBar.js
│       ├── FeedbackChart.js
│       ├── GenderAndAge.js
│       ├── TrafficLightComponent.js
│       ├── SpeechTaskCalibration.js
│       ├── SpeechTaskCalibrationDialog.js
│       ├── CountdownBeforeTask.js
│       ├── CountdownSpeechTask.js
│       ├── CheckboxForPriorParticipation.js
│       ├── Transition.js
│       ├── ExplanationSpeechTask.js
│       └── VideoForm.js
└── build/                      # Production build output (generated)
```

### How the Application Works

**Routing (`App.js`):**

The app uses `HashRouter` (URLs like `yoursite.com/#/stresstask`). Four routes exist:

| Route | Component | Purpose |
|---|---|---|
| `/` | Main | The study (default entry) |
| `/stresstask` | Main | Alias for the study |
| `/dataProtection` | DataProtection | Static data protection page |
| `/imprint` | Imprint | Static legal imprint page |
| `*` | Error | 404 page |

**Central Controller (`Main.js`):**

`Main.js` is the single most important file. It is a React class component that:

- Holds **all study state** via `this.state` — including `pageIndex`, `slideIndex`, the `studyPagesSequence` array, and `slideSequences` object
- Holds **all collected data** via `this.data` — math performance, VAS/PANAS responses, speech feedback, metadata, timestamps
- **Renders the current page** using a `switch` statement on `studyPagesSequence[pageIndex]`
- **Manages navigation** — `handleNext()` increments `slideIndex`, advancing to the next slide or the next page when slides are exhausted
- **Handles data upload** — `uploadData()` and `uploadFinalData()` send data to JATOS
- **Tracks video upload state** — `markVideoAsUploading()` and `markVideoAsUploaded()` manage async video uploads
- **Manages the cancel dialog** — open/close state and timestamp logging

All page components receive their data and callbacks as props from `Main.js`. Pages do not manage their own persistent state.

**Page Components (`src/pages/`):**

Each page component renders the slides for its section. Pages receive:
- `slideIndex` — which slide to show
- `handleNext()` — callback to advance to the next slide
- Data collection callbacks (e.g., `handBackStressData()`, `continueFromPanas()`)

**Reusable Components (`src/components/`):**

Components are smaller UI pieces used across multiple pages. Key components:

| Component | Used By | Purpose |
|---|---|---|
| `VisualAnalogueScale` | Introduction, SpeechTaskTutorial, EndPage | 5-point slider questionnaire |
| `Panas` | Introduction, EndPage | Mood questionnaire |
| `Calibration` | Introduction | 4-state webcam setup flow |
| `WebcamCapture` | Calibration, MathTask, SpeechTask | Records and uploads video |
| `AudioAnalyser` | SpeechTask | Analyzes microphone input volume |
| `AudioVisualiser` | SpeechTask | Renders audio waveform |
| `TrafficLightComponent` | SpeechTask | Faked performance indicator |
| `TaskFrame` | MathTask | Displays current math question |
| `NumberInputField` | MathTask | Custom numeric keypad |
| `FeedbackChart` | MathTask, MathTaskResult | Bar chart (score vs. faked average) |
| `CancelDialog` | Main (global) | Cancellation options modal |
| `StepperWithLabels` | Multiple pages | Progress indicator |

---

## 6. Data Collection and Output

When `REACT_APP_LOGGING` is set to `'true'`, the DST collects the following data and uploads it to the JATOS backend.

### Collected Data

#### Math Task Performance (`mathTaskPerformance`)

One entry per math question answered:

| Field | Type | Description |
|---|---|---|
| `subject_id` | string | Participant ID |
| `question_number` | number | Sequential question number |
| `begin_total_time` | number | Time (ms) since task start when question appeared |
| `end_total_time` | number | Time (ms) since task start when answer was submitted |
| `time_paused` | number | Time (ms) spent paused (if any) |
| `time_available` | number | Time limit (ms) for this question |
| `time_needed` | number | Time (ms) participant took to answer |
| `task_question` | string | The math expression shown (e.g., "23 + 45") |
| `task_answer` | number | Correct answer |
| `task_input` | string | What the participant entered |
| `task_feedback` | string | Feedback shown ("correct", "wrong", "slow") |
| `correct_answer` | boolean | Whether the answer was correct |
| `user_interaction` | boolean | Whether the participant entered anything |

#### VAS Feedback (`vasFeedback`)

Collected at three timepoints: `baseline` (Introduction), `intermediate` (SpeechTaskTutorial), `end` (EndPage).

Each timepoint contains slider values (0–100) for the VAS items defined in your translation file. Default items:

| Item | Description |
|---|---|
| `overwhelmed` | "I feel overwhelmed" |
| `tension` | "I feel tension" |
| `stressed` | "I feel stressed" |

> **Note:** The exact items depend on your translation file and VAS component configuration. Check `vas_questions.*` in your translation JSON.

#### PANAS Feedback (`panasFeedback`)

Collected at two timepoints: `begin_panas` (Introduction) and `end_panas` (EndPage).

Each timepoint contains item scores on a 5-point scale (0–4). Default items from the German PANAS:

| Item Key | Description |
|---|---|
| `freudig` | Cheerful/joyful |
| `gereizt` | Irritated |
| `besorgt` | Worried/anxious |
| `zufrieden` | Satisfied |
| `unsicher` | Insecure |
| `entspannt` | Relaxed |
| `traurig` | Sad |
| `aufgeregt` | Excited/agitated |

> **Note:** The PANAS items are defined in the translation file under `panas.*`. If you translate or replace items, the data keys will follow your translation file structure.

#### Speech Task Feedback (`speechTaskFeedback`)

Continuous audio analysis logged approximately every 60 audio processing frames during speech recordings:

| Field | Type | Description |
|---|---|---|
| `subjectId` | string | Participant ID |
| `stage` | string | Current speech task phase (e.g., "runTask1") |
| `feedback` | string | Whether participant is pausing |
| `noiseLevel` | number | Current audio input level |
| `relativeTime` | number | Time since recording started |

#### Speech Test Analysis (`speechTestAnalysis`)

Summary statistics computed per speech question:

| Field | Type | Description |
|---|---|---|
| `speakingTickCounter` | number | Number of audio frames where speech was detected |
| `speakBreakCounter` | number | Number of detected pauses |
| `audioMean` | number | Mean audio level during the answer |
| `volumeHigh` | number | Peak volume level |

#### Study Metadata (`studyMetaTracker`)

| Field | Type | Description |
|---|---|---|
| `studyId` | string | JATOS study ID |
| `studyTitle` | string | JATOS study title |
| `studyUuid` | string | JATOS study UUID |
| `componentId` | string | JATOS component ID |
| `studyResultId` | string | JATOS result ID (used in file naming) |
| `workerId` | string | JATOS worker ID |
| `type` | string | Always "DST" |
| `device` | string | Participant's device model |
| `operatingSystem` | string | OS name and version |
| `browser` | string | Browser name and version |
| `language` | string | Language code used |
| `age` | string | Participant-reported age |
| `gender` | string | Participant-reported gender |
| `participantId` | string | Participant ID entered on start page |
| `videosSubmitted` | number | Count of videos uploaded |
| `urlQueryParameters` | string | URL query parameters |
| `surveyURL` | string | Generated survey redirect URL |

#### Study Timestamps (`studyTimes`)

All timestamps in milliseconds relative to a `reference` epoch:

| Field | Description |
|---|---|
| `reference` | Epoch timestamp (ms) used as baseline |
| `test_start` | When the study started |
| `test_end` | When the study ended |
| `panasBaseline_start` / `_end` | Baseline PANAS timing |
| `mathTask_start` / `_end` | Math task timing |
| `speechTask_start` / `_end` | Speech task timing |
| `panasEnd_start` / `_end` | Final PANAS timing |
| `cancel_dialog` | Array of open/close timestamp pairs |

#### Prior Participation (`checkBoxForPriorParticipation`)

| Field | Type | Description |
|---|---|---|
| `participated` | boolean | Whether participant has done the DST before |

### Uploaded Files

All files are uploaded to JATOS using the JATOS JavaScript API. File names follow the pattern `{studyResultId}_filename`:

| File | Format | Content |
|---|---|---|
| `{id}_mathTask.json` | JSON | Math task performance array |
| `{id}_metaParticipantData.json` | JSON | Metadata, timestamps, VAS, PANAS |
| `{id}_data_storage.txt` | Text | Data storage configuration (`save_all_data`, `save_no_data`, `save_without_video`) |
| `{id}_introduction_1.webm` | Video | Calibration recording |
| `{id}_mathTask_1.webm` | Video | Math task recording |
| `{id}_speechTask_1.webm` | Video | Speech task recording |

> **Note:** Video format depends on the participant's browser. Most modern mobile browsers produce `.webm` files. Some may produce `.mp4`.

### Data Storage Configuration

The `_data_storage.txt` file controls what happens to participant data server-side:

| Value | Meaning |
|---|---|
| `save_all_data` | Keep all data including videos (set after debriefing) |
| `save_no_data` | Delete all data (set on cancel with no data) |
| `save_without_video` | Keep JSON data but delete videos (set on cancel without video) |

Server-side scripts (running as cron jobs) read this file to determine how to process the participant's data. See [Section 7](#7-deployment) for data management details.

---

## 7. Deployment

### Server Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk | 100 GB | 500 GB+ (if collecting video) |
| OS | Any Linux (Debian-based recommended) | Ubuntu 22.04 LTS |
| Network | Public IP or domain | Domain with SSL certificate |

You can use a physical machine, a university VM, or a cloud provider (Azure, AWS, DigitalOcean).

### Software Stack

1. **Docker** — runs the JATOS container
2. **Nginx** — reverse proxy for port mapping and SSL termination
3. **JATOS** — study management backend (runs inside Docker)
4. **Node.js 16** — for building the DST frontend (can be on a separate build machine)

### Step-by-Step Setup

#### Step 1: Install Docker

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io
sudo systemctl enable docker
sudo systemctl start docker
```

#### Step 2: Install and Run JATOS

```bash
# Pull the latest JATOS image
sudo docker pull jatos/jatos:latest

# Run JATOS (port 9000 inside the container)
sudo docker run -d \
  --name jatos \
  -p 9000:9000 \
  -v jatos-data:/opt/jatos_data \
  jatos/jatos:latest
```

JATOS is now running at `http://your-server:9000`. The default admin credentials are shown in the JATOS logs:

```bash
sudo docker logs jatos
```

For full JATOS Docker installation options, see: https://www.jatos.org/Install-JATOS-via-Docker.html

#### Step 3: Install and Configure Nginx

```bash
sudo apt update
sudo apt install nginx
```

Create an Nginx configuration to proxy requests to JATOS:

```nginx
# /etc/nginx/sites-available/jatos
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for large video uploads
        client_max_body_size 500M;
        proxy_read_timeout 300s;
    }
}
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/jatos /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

For detailed Nginx + JATOS configuration, see: https://www.jatos.org/JATOS-with-Nginx.html

#### Step 4: Set Up SSL (HTTPS)

Use Certbot for free SSL certificates:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Follow the prompts to obtain and install the certificate. Certbot will automatically update your Nginx configuration.

#### Step 5: Build the DST

On your build machine (can be your local computer):

```bash
git clone https://github.com/mbp-lab/openDST.git
cd openDST

# Edit .env — set PUBLIC_URL to match your JATOS study assets folder name
# Example: PUBLIC_URL=/study_assets/my-dst-study

npm install
npm run build
```

#### Step 6: Deploy to JATOS

**Option A: Copy build files into the Docker container**

```bash
# Find your JATOS container name
sudo docker ps

# Copy the build output to the JATOS study assets directory
# The folder name must match the PUBLIC_URL in .env (without /study_assets/ prefix)
sudo docker cp build/. jatos:/opt/jatos_data/study_assets_root/my-dst-study
```

**Option B: Import via JATOS GUI**

1. Package the `build/` folder as a `.jzip` file (JATOS ZIP format — a standard zip file with a `.jzip` extension)
2. Log into the JATOS web interface at `https://your-domain.com`
3. Click "Import Study"
4. Upload the `.jzip` file
5. Configure the study settings in JATOS (worker types, etc.)

#### Step 7: Create a Study in JATOS

1. Log into the JATOS GUI
2. If you used Option A (docker cp), create a new study and point it to your study assets folder
3. If you used Option B (import), the study should already be visible
4. Configure worker types (e.g., "General Multiple" for anonymous participants, or "Personal Multiple" for tracked participants)
5. Generate study links to distribute to participants

### Data Management

During the study, video files and JSON data are uploaded into the JATOS Docker container. For security, these files should be moved to a separate storage server that is not exposed to the internet.

**Recommended approach:**

1. **Extract files from Docker to the host machine** using a cron job:

```bash
# Example: run every 5 minutes
*/5 * * * * docker cp jatos:/opt/jatos_data/study_assets_root/my-dst-study/uploads/ /home/data/raw/
```
2. **Transfer files to a secure storage server**

3. **Process data storage preferences** by reading each participant's `_data_storage.txt` file and deleting videos or all data as specified.


---

## 8. Troubleshooting and FAQ

### Common Issues

**"Please use your smartphone" message on desktop**

The DST is mobile-only by default. For desktop testing:
- Set `REACT_APP_MOBILE_ONLY = 'false'` in `.env` and rebuild, OR
- Open browser developer tools (F12) and toggle the device toolbar to simulate a mobile viewport

**Videos are not being uploaded**

Both flags must be enabled:
```env
REACT_APP_VIDEO_RECORDING = 'true'
REACT_APP_LOGGING = 'true'
```
Also check that the participant's browser supports `MediaRecorder` API (most modern mobile browsers do).

**Build fails with Node.js errors**

The project requires Node.js v16.x. Newer versions may cause compatibility issues with `react-scripts` 3.x:
```bash
# Check your version
node --version

# Use nvm to install v16 if needed
nvm install 16
nvm use 16
```

**JATOS study page shows a blank screen or 404**

The `PUBLIC_URL` in `.env` must match the JATOS study assets folder name exactly:
```
PUBLIC_URL=/study_assets/my-dst-study
                         ^^^^^^^^^^^^
                         This must match the folder name in JATOS
```

**Translations are not showing (raw keys displayed)**

- Check that the language code in `i18n.js` matches your translation file directory name
- Verify the translation JSON file has no syntax errors (use a JSON validator)
- Ensure the import path in `i18n.js` is correct

**Camera or microphone not working**

- The DST requires HTTPS for camera/microphone access (browsers block these APIs on HTTP)
- Check that the participant granted camera and microphone permissions
- Some mobile browsers require the user to interact with the page before media access is allowed

**Participant data not appearing in JATOS**

- Verify `REACT_APP_LOGGING = 'true'` in `.env`
- Check the JATOS worker type — some types (like "Jatos" workers) are for testing only
- Check the JATOS logs for upload errors: `sudo docker logs jatos`

**Math task feedback chart not showing**

Ensure `chart.js` and `react-chartjs-2` are installed. Run `npm install` if you see missing module errors.

### FAQ

**Q: Can I use the DST without JATOS?**
A: JATOS is the recommended backend, and the DST's data upload functions use the JATOS JavaScript API (`jatos.uploadResultFile()`, `jatos.submitResultData()`). Using a different backend would require rewriting the data upload logic in `Main.js`.

**Q: Can I run the DST on desktop (not mobile)?**
A: Yes, set `REACT_APP_MOBILE_ONLY = 'false'` in `.env`. However, the UI is designed for mobile screens and has no dedicated desktop layout. It will work but may not look optimal.

**Q: How many participants can run simultaneously?**
A: This depends on your server hardware, especially if video recording is enabled. Each participant uploads multiple video files (potentially hundreds of MB). With the recommended specs (4 CPU, 4GB RAM, 500GB disk), dozens of simultaneous participants should be feasible without video, fewer with video recording enabled.

**Q: Can I change the math task duration from 90 seconds?**
A: Yes, edit the timer duration constant in `src/pages/MathTask.js`.

**Q: Can I change the speech task timing (10s prep, 20s answer)?**
A: Yes, edit the countdown durations in `src/pages/SpeechTask.js`.

---

## Additional Resources

- **JATOS Documentation:** https://www.jatos.org
- **JATOS Docker Installation:** https://www.jatos.org/Install-JATOS-via-Docker.html
- **JATOS with Nginx:** https://www.jatos.org/JATOS-with-Nginx.html
- **DST Website:** https://www.digitalstresstest.org
- **DST Source Code:** https://github.com/mbp-lab/openDST
- **Contact:** mnorden@techfak.uni-bielefeld.de
