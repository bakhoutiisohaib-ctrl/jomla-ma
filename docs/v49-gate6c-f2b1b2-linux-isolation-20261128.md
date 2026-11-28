# Gate 6C.3B.1B.2 — native video isolation, disposable Linux lab

**PASS_SCOPED_LINUX_LAB; application/production worker remains OPEN.** Baseline b40e73a0376d5d459123f1fba124bcecf1e526cd. The previous offline Windows normalizer proved FFmpeg 9.1 could process the synthetic samples, but not OS isolation. Docker/Podman not available on checked Windows machine, WSL list failed previously. No OS installation, firewall change, VPS operation or deployment was undertaken.

## Actual isolation experiment

Executed the two Python scripts in a disposable, separate x86_64 Linux container (kernel 6.18.57, Debian FFmpeg 7.1.5; not the owner's Windows PC or Ubuntu VPS). User-namespace mount/proc setup failed, Landlock syscall returned ENOSYS and cgroup filesystem was read-only; these mechanisms were not credited as working. A root-only offline launcher creates the security boundary by entering a pre-provisioned root-owned minimal chroot, dropping real/effective/saved IDs to an unused lab UID/GID, removing supplementary groups, closing inherited descriptors except three anonymous pipes, setting no_new_privs, and loading a default-deny seccomp allowlist before exec of a fixed native program. Only a narrowly matched pthread clone flag set is allowed; clone3 receives ENOSYS for libc fallback. The trusted harness provisions the root with 211 copied runtime libraries, two FFmpeg tools and a compiled benign test probe, then removes the temporary jail. No host app/data mounts, device files or proc mount were provided. Chroot alone is not asserted to be a sandbox. References: https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html and https://www.kernel.org/doc/html/latest/userspace-api/no_new_privs.html.

Provisional hard rlimits: 768 MiB virtual address space per process (not RSS or cgroup-wide memory), 8 CPU seconds, 16 tasks per dedicated UID, 32 descriptors, zero core/file growth. The synthetic harness has a 15s subprocess timeout. Its capture is for fixed trusted fixtures only; it is not a bounded untrusted upload service.

## Test evidence

Initial native isolation probe and actual FFmpeg runs succeeded. Review strengthened anonymous pipe checks and inherited-FD closure, then executed the reproducible harness with CPU-burn, hard-limit raise, thread-count, unsafe-jail refusal, two complete normalization/redecode and two invalid-input cases. Final result: [summary](evidence/v49-gate6c-f2b1b2-20261128/summary.json). AF_INET, AF_INET6 and AF_UNIX socket creation denied; /etc/passwd and /proc unavailable inside the jail; attempted file creation and fork denied; 1 GiB allocation failed; normal pthread works but only 15 additional threads created; setuid(0), raising hard AS limit and access to an inherited external descriptor failed. CPU burn killed with signal 9, measured 7.83s elapsed; world-writable jail rejected before exec. Synthetic H.264 MP4 and VP9 WebM both produced H.264 MP4, 48 decoded frames / 2 seconds, and invalid inputs failed. Results are scoped to this OS/tool build and these tests.

Reproduce only inside a disposable dedicated Linux x86_64 lab as root, with trusted tools and Python source, never on the production host or via HTTP:

```bash
python3 backend/scripts/verify-video-isolation.py /tmp/new-video-isolation-result.json
```

Requires trusted ffmpeg, ffprobe, cc, ldd, libseccomp.so.2. The scripts are offline lab artifacts, not a privileged service. Source copied to the Windows integration checkout and exact LF SHA-256 verified against the executed Linux sources: launcher 81d52c5a6862869f0b643459e605c1c6d4dc3c7ca6aa55a864cb1cba5f6a27d5; harness 18424e41e0abcede51ac6b36525f3de2ee692dca2d715c3dcf55a930ad14a237.

## Open boundaries

No guarantee against kernel/native decoder exploits, root provisioning mistakes, writable mounts or race in dedicated UID reservation. The lab allowlist is architecture/glibc/tool-build specific; the Linux FFmpeg version differs from the Windows probe. This is not a general production sandbox and must not be called from the web application, especially not as root. No cgroup aggregate limit, production resource/concurrency/restart acceptance, output capture budget on arbitrary input, full codec/malformed media coverage or deployment readiness claim. Next: nonprivileged application-facing worker contract, pinned runtime/environment, fail-closed admission and output budgets, isolated job lifecycle/concurrency/cleanup tests and target Linux worker acceptance. Keep upload route disabled until that boundary passes. No frontend, dependencies, original project/data, design reference, hosting or original database changes. The original reference hash and original checkout HEAD were rechecked. Previous Jest evidence remains historical; no new app runtime modifications in this slice.
