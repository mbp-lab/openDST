# Face-crop backlog

- Replace the hard-coded 30 fps AVI rate with the actual camera input rate.
- Retain every available camera frame; change processing pipeline to nonblocking workers.
- Change event json to reduce filesize: log detection loss and missed frames.
- Optionally add detection rate limits.
- Review upload file naming.
