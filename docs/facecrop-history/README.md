# Facecrop campaign archive

Archived on 2026-10-07 during the extraction of `facecrop/` into the reusable `browser-facecrop/` submodule. These documents and the `campaign/` corpus preserve the 2026-10-06 campaign evidence from openDST source commit `3d2258886e13f722d82464ccb7b685c832007f0b`.

Start with the [acceptance report](campaign/acceptance-report.md), [campaign scope](refactor-campaign.md), or [final disposition](campaign/disposition.md). Historical command examples, paths, artifact hashes, test counts, and environment measurements describe their recorded checkpoints; they are not current setup instructions. Navigable links now point to the corresponding extracted library or study files.

For current installation and reuse, see the [library README](../../browser-facecrop/README.md) and [study setup](../../Setup.md). The study-specific JATOS harness now lives at [tests/facecrop/browser-jatos.cjs](../../tests/facecrop/browser-jatos.cjs); it reads the built distribution from `browser-facecrop/dist` and still requires the documented disposable JATOS fixtures and external Playwright installation.
