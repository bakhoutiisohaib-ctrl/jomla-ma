#!/usr/bin/env python3
"""Offline Linux isolation experiment. Never invoke from the web application.
Only root-owned, operator-provisioned synthetic test jails and trusted binaries.
"""
import ctypes as C
import errno, os, platform, resource, stat, sys
from pathlib import Path

UID = 61001
GID = 61001
AS_BYTES = 768 * 1024 * 1024
CPU_SECONDS = 8
THREADS = 16
ALLOW = '''read write readv writev close fstat newfstatat stat statx lstat lseek
pread64 mmap mprotect munmap mremap madvise brk arch_prctl access faccessat faccessat2
openat open readlink readlinkat getcwd getdents64 fcntl ioctl dup dup2 dup3 pipe pipe2
poll ppoll select pselect6 epoll_create1 epoll_ctl epoll_wait epoll_pwait
rt_sigaction rt_sigprocmask rt_sigreturn sigaltstack futex futex_waitv set_tid_address
set_robust_list rseq getrandom clock_gettime clock_getres gettimeofday time nanosleep
clock_nanosleep sched_getaffinity sched_yield getpid getppid gettid getuid geteuid
getgid getegid getgroups getrlimit prlimit64 getrusage sysinfo uname getcpu
exit exit_group execve restart_syscall membarrier'''.split()

class Compare(C.Structure):
    _fields_ = [('arg', C.c_uint), ('op', C.c_int), ('a', C.c_uint64), ('b', C.c_uint64)]

def check(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def main():
    check(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x86_64 required')
    check(os.geteuid() == 0 and len(sys.argv) >= 3, 'root lab launcher, jail and executable required')
    root = Path(sys.argv[1]).resolve(strict=True)
    check(root != Path('/') and root.is_dir(), 'dedicated jail required')
    # The operator must provision a private, immutable tree; no app, host mounts or secrets.
    def verify(p):
        s = p.lstat()
        check(s.st_uid == 0 and not s.st_mode & 0o7022, 'unsafe ownership/mode: ' + str(p))
        check(stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode), 'not a regular file/directory: ' + str(p))
        if stat.S_ISREG(s.st_mode):
            check(s.st_nlink == 1, 'hard-linked file')
    for p in [root, *root.parents]:
        # Sticky /tmp is acceptable only as an ancestor of the root-owned jail in this lab.
        s = p.lstat()
        check(s.st_uid == 0 and stat.S_ISDIR(s.st_mode) and (not s.st_mode & 0o022 or (p == Path('/tmp') and s.st_mode & stat.S_ISVTX)), 'unsafe ancestor')
    for p in root.rglob('*'):
        verify(p)
    verify(root)
    exe = sys.argv[2]
    check(exe in ('/bin/ffmpeg','/bin/ffprobe','/bin/probe'), 'fixed lab executable required')
    check((root / exe[1:]).is_file(), 'missing executable')
    check(all(stat.S_ISFIFO(os.fstat(i).st_mode) and os.readlink('/proc/self/fd/'+str(i)).startswith('pipe:[') for i in range(3)), 'stdio must be anonymous lab pipes')
    for fd in [int(n) for n in os.listdir('/proc/self/fd') if int(n) > 2]:
        try:
            os.close(fd)
        except OSError as e:
            if e.errno != errno.EBADF:
                raise
    # Dedicated test UID; avoid sharing credentials with an existing process.
    for p in Path('/proc').glob('[0-9]*/status'):
        try:
            line = next(x for x in p.read_text().splitlines() if x.startswith('Uid:'))
            check(str(UID) not in line.split()[1:], 'lab UID already in use')
        except (FileNotFoundError, ProcessLookupError):
            pass
    libc = C.CDLL(None, use_errno=True)
    sec = C.CDLL('libseccomp.so.2', use_errno=True)
    sec.seccomp_init.argtypes = [C.c_uint32]; sec.seccomp_init.restype = C.c_void_p
    sec.seccomp_syscall_resolve_name.argtypes = [C.c_char_p]; sec.seccomp_syscall_resolve_name.restype = C.c_int
    sec.seccomp_rule_add_array.argtypes = [C.c_void_p,C.c_uint32,C.c_int,C.c_uint,C.POINTER(Compare)]
    sec.seccomp_load.argtypes = [C.c_void_p]
    ctx = sec.seccomp_init(0x00050000 | errno.EPERM)
    check(ctx, 'seccomp initialization failed')
    def rule(name, action, cmp=None):
        nr = sec.seccomp_syscall_resolve_name(name.encode())
        check(nr >= 0, 'unsupported syscall name: ' + name)
        check(sec.seccomp_rule_add_array(ctx, action, nr, int(cmp is not None), C.byref(cmp) if cmp is not None else None) == 0, 'seccomp rule failed: ' + name)
    for name in ALLOW:
        rule(name, 0x7fff0000)
    # Permit only glibc pthread clone flags, never a new process/namespace.
    flags = 0x003d0f00
    rule('clone', 0x7fff0000, Compare(0, 4, flags, 0))  # SCMP_CMP_EQ
    rule('clone3', 0x00050000 | errno.ENOSYS)
    os.chdir(root); os.chroot('.'); os.chdir('/')
    os.setgroups([]); os.setgid(GID); os.setuid(UID)
    check(os.getresuid() == (UID,)*3 and os.getresgid() == (GID,)*3 and not os.getgroups(), 'credential drop failed')
    for which, value in [(resource.RLIMIT_AS,AS_BYTES),(resource.RLIMIT_CPU,CPU_SECONDS),(resource.RLIMIT_NPROC,THREADS),(resource.RLIMIT_NOFILE,32),(resource.RLIMIT_CORE,0),(resource.RLIMIT_FSIZE,0)]:
        resource.setrlimit(which, (value,value))
    check(libc.prctl(38,1,0,0,0) == 0, 'no_new_privs failed')
    check(sec.seccomp_load(ctx) == 0, 'seccomp load failed')
    os.execve(exe, sys.argv[2:], {'LANG':'C','LC_ALL':'C','HOME':'/','PATH':'/bin'})

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('ISOLATION_REFUSED: '+str(e), file=sys.stderr)
        sys.exit(125)
