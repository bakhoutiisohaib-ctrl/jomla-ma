# Gate 6C.3B.1B — offline native decoder/normalizer experiment

Status: **PASS for the offline synthetic-video experiment only; production worker isolation and the entire video gate remain OPEN.** Source baseline: b69b6a81539f090d6151fa4a68cb0bf031b45d46.

## Execution and provenance

A Gyan FFmpeg 9.1 Windows essentials build was downloaded into the private experiment directory outside the repository, not installed globally or added to application dependencies. Archive SHA-256 matched the distributor-published checksum before extraction. This is distributor integrity verification, not an independent supply-chain/security audit.

- Archive SHA-256: 835b9a733445ba7a56a37a26cf7bde84e2f3ce7da2a8ec984276bb2abb1b922c
- ffmpeg.exe SHA-256: ed8f66cb877087a96f5bbb40a2944f0e764f2ad8870d5cb647360d912e62bc07
- ffprobe.exe SHA-256: df0199f606faa88e9ad192732a7c3987acfb647663534c297772e17730611a08
- Synthetic Chrome H.264 MP4 SHA-256: ed6c9542365251a9a22a2ee2c786d9ced762151d8f763d8c433a7d81bb47bef0
- Synthetic Chrome VP9 WebM SHA-256: 2bf4483287e4c6b435b346be34e4b7c95c37ed779a05a6160740e00971a169c9

The dependency-free preflight from 1A runs first. The experiment uses explicit executable paths, no shell, pipe-only input protocol, disabled MOV external data references/absolute paths, limited environment, 15-second per-process timeout, stdout/stderr limits, 64 MiB maximum individual allocation and limited decoder/encoder threads. It checks a single video track, codec allowlist, even dimensions/pixel area and a provisional 30-second output duration/frame cap. It normalizes to fragmented H.264 MP4 at 24 fps with metadata/chapters stripped, then independently probes and decodes the output. No input is published. This is a deliberately limited silent-video pilot: audio-bearing clips are rejected rather than silently discarded; this is not a final commercial requirement.

## Review and retest

The initial native probe passed; review added explicit executable/fixture/output paths, a new-output-directory requirement, version checks for both binaries and a reproducible offline command. The repository script was syntax-checked and executed again against the same synthetic samples. Final result: 15/15 expected cases, comprising 2 successful real normalizations, 10 expected rejections and 3 process-budget checks. The exact final results are in [summary](evidence/v49-gate6c-f2b1b-20261128/summary.json).

Reproduce using verified matching binaries and synthetic Chrome recorder.mp4 and recorder.webm fixtures only:

```powershell
node backend/scripts/verify-video-normalizer.cjs <ffmpeg.exe> <ffprobe.exe> <synthetic-fixture-dir> <new-output-dir> 9.1-essentials_build-www.gyan.dev
```

The synthetic source clips and downloaded executables remain outside Git. No application route, product schema, image upload path, original database, V4.9 visual reference, hosting or deployment was changed. The repository script is an offline probe, not a production validator.

## Open security boundary

Protocol allowlisting, child-process timers and per-allocation limits do **not** establish OS-level network/filesystem isolation, total memory/CPU limits, reliable descendant termination or a hardened sandbox. Docker/Podman commands were not found on the checked Windows machine; WSL listing exited 1 and no usable Linux distribution was established. Do not process real customer uploads with this probe. Production deployment must verify a least-privileged isolated worker with denied egress, constrained mounts and enforced aggregate resource/process limits; exercise failure/cleanup, concurrency and restart behavior. No general proof of codec safety, all MP4/WebM variants, browser compatibility, audio policy, or complete decoded source duration is claimed. A normalized-duration cap cannot alone prove every malformed input timestamp is trustworthy.

Next: finish the worker isolation/acceptance boundary before wiring an upload endpoint; then ownership/rights, private storage, product receipts, playback, UI and integrated acceptance. Gate 6C.3B remains OPEN.
