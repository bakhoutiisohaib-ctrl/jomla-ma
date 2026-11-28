#!/usr/bin/env python3
"""Root-only disposable Linux lab; synthetic samples only, not production setup.
Requires trusted host ffmpeg/ffprobe, cc, ldd and libseccomp.so.2. No install.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

LAUNCHER = Path(__file__).with_name('video-isolation-lab.py')
PROBE = r'''
#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/prctl.h>
#include <fcntl.h>
#include <pthread.h>
#include <string.h>
#include <stdlib.h>
static void *thread(void *x){return x;}
static void *hold(void *x){sleep(2);return x;}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"cpu")){volatile unsigned long x=0;for(;;)x++;}
 struct rlimit a,c,n,f; getrlimit(RLIMIT_AS,&a);getrlimit(RLIMIT_CPU,&c);getrlimit(RLIMIT_NPROC,&n);getrlimit(RLIMIT_FSIZE,&f);
 int sock=socket(AF_INET,SOCK_STREAM,0),sock6=socket(AF_INET6,SOCK_STREAM,0),local=socket(AF_UNIX,SOCK_STREAM,0);
 int outside=open("/etc/passwd",O_RDONLY),writefd=open("/escape-test",O_WRONLY|O_CREAT,0600),proc=open("/proc/self/status",O_RDONLY);
 pid_t child=fork();if(child==0)_exit(1);
 void *p=mmap(NULL,1024UL*1024*1024,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 pthread_t t; int rc=pthread_create(&t,NULL,thread,NULL);if(!rc)pthread_join(t,NULL);
 pthread_t pool[32];int count=0;for(;count<32;count++)if(pthread_create(&pool[count],NULL,hold,NULL))break;
 for(int i=0;i<count;i++)pthread_join(pool[i],NULL);
 int priv=setuid(0),fd=argc>1?fcntl(atoi(argv[1]),F_GETFD):-1;
 struct rlimit raise={1024UL*1024*1024,1024UL*1024*1024};int raised=setrlimit(RLIMIT_AS,&raise);
 int ok=getuid()==61001&&geteuid()==61001&&getgid()==61001&&sock<0&&sock6<0&&local<0&&outside<0&&writefd<0&&proc<0&&child<0&&p==MAP_FAILED&&rc==0&&count>0&&count<=15&&priv<0&&fd<0&&raised<0&&a.rlim_cur==768UL*1024*1024&&c.rlim_cur==8&&n.rlim_cur==16&&f.rlim_cur==0;
 printf("{\"uid\":%d,\"networkDenied\":%s,\"outsideReadDenied\":%s,\"writeDenied\":%s,\"procDenied\":%s,\"forkDenied\":%s,\"memoryDenied\":%s,\"threadAllowed\":%s,\"threadsCreated\":%d,\"privilegeDenied\":%s,\"inheritedFdClosed\":%s,\"limitRaiseDenied\":%s,\"limitsVerified\":%s}\n",getuid(),sock<0&&sock6<0&&local<0?"true":"false",outside<0?"true":"false",writefd<0?"true":"false",proc<0?"true":"false",child<0?"true":"false",p==MAP_FAILED?"true":"false",rc==0?"true":"false",count,priv<0?"true":"false",fd<0?"true":"false",raised<0?"true":"false",ok?"true":"false");return ok?0:1;
}
'''

def require(ok, msg):
    if not ok:
        raise RuntimeError(msg)

def main():
    require(os.geteuid() == 0 and len(sys.argv)==2, 'root synthetic lab; one new result path required')
    result=Path(sys.argv[1]).resolve(); require(not result.exists(), 'result already exists')
    with tempfile.TemporaryDirectory(prefix='jomla-video-lab-',dir='/tmp') as temp:
        p=Path(temp); p.chmod(0o755); jail=p/'jail'; (jail/'bin').mkdir(parents=True)
        (p/'probe.c').write_text(PROBE)
        subprocess.run(['cc','-O2','-pthread',str(p/'probe.c'),'-o',str(jail/'bin/probe')],check=True)
        for name in ['ffmpeg','ffprobe']:
            src=shutil.which(name); require(src, 'missing '+name); shutil.copyfile(src,jail/'bin'/name); (jail/'bin'/name).chmod(0o755)
        libs=set()
        for executable in (jail/'bin').iterdir():
            for line in subprocess.check_output(['ldd',str(executable)],text=True).splitlines():
                require('not found' not in line,'missing runtime library')
                m=re.search(r'(?:=>\s+)?(/\S+)\s+\(',line)
                if m: libs.add(m.group(1))
        for lib in libs:
            dest=jail/lib.lstrip('/'); dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(lib,dest); dest.chmod(0o755)
        cmd=[sys.executable,str(LAUNCHER),str(jail)]
        def run(exe,args=(),data=b'',**kwargs):
            return subprocess.run(cmd+[exe,*args],input=data,capture_output=True,timeout=15,**kwargs)
        def checked(exe,args=(),data=b'',**kwargs):
            r=run(exe,args,data,**kwargs); require(r.returncode==0,r.stderr.decode(errors='replace')[-500:]); return r.stdout
        marker=p/'outside-marker'; marker.write_text('synthetic private marker')
        with marker.open('rb') as handle:
            probe=json.loads(checked('/bin/probe',[str(handle.fileno())],pass_fds=(handle.fileno(),)))
        require(probe['limitsVerified'] and probe['threadsCreated']<=15,'isolation probe failed')
        started=time.monotonic(); cpu=run('/bin/probe',['cpu']); elapsed=time.monotonic()-started
        require(cpu.returncode==-9 and elapsed>=7 and elapsed<15,'CPU limit was not enforced')
        # Refuse an unsafe jail before executing any native program.
        unsafe=jail/'unsafe'; unsafe.mkdir(); unsafe.chmod(0o777)
        refused=run('/bin/probe'); require(refused.returncode==125 and b'ISOLATION_REFUSED' in refused.stderr,'writable jail accepted'); unsafe.rmdir()
        common=['-hide_banner','-v','error','-max_alloc','67108864']
        def input_args(fmt):
            return ['-protocol_whitelist','pipe','-f','mov' if fmt=='mp4' else 'matroska']+(['-enable_drefs','0','-use_absolute_path','0'] if fmt=='mp4' else [])+['-i','pipe:0']
        video=[]
        for fmt,codec in [('mp4','libx264'),('webm','libvpx-vp9')]:
            data=subprocess.check_output(['ffmpeg','-hide_banner','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','2','-an','-c:v',codec,'-threads','1']+(['-movflags','+frag_keyframe+empty_moov+default_base_moof'] if fmt=='mp4' else [])+['-f',fmt,'pipe:1'])
            metadata=json.loads(checked('/bin/ffprobe',common+input_args(fmt)+['-show_entries','stream=codec_type,codec_name,width,height','-of','json'],data))['streams']
            require(len(metadata)==1 and metadata[0]['codec_name']==('h264' if fmt=='mp4' else 'vp9'),'source mismatch')
            decode=['-nostdin','-xerror','-abort_on','empty_output+empty_output_stream','-threads','1','-max_pixels','2073600','-err_detect','explode']
            mapping=['-map','0:v:0','-an','-sn','-dn']
            out=checked('/bin/ffmpeg',common+['-filter_threads','1','-filter_complex_threads','1']+decode+input_args(fmt)+mapping+['-map_metadata','-1','-map_chapters','-1','-t','31','-vf','fps=24','-c:v','libx264','-threads','1','-preset','veryfast','-pix_fmt','yuv420p','-crf','24','-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],data)
            output=json.loads(checked('/bin/ffprobe',common+input_args('mp4')+['-show_entries','stream=codec_type,codec_name,width,height','-of','json'],out))['streams']
            progress=checked('/bin/ffmpeg',common+decode+input_args('mp4')+mapping+['-progress','pipe:1','-nostats','-f','null','pipe:2'],out).decode()
            require(len(output)==1 and output[0]['codec_name']=='h264' and output[0]['width']==320 and output[0]['height']==180,'output mismatch')
            require('progress=end' in progress and re.findall(r'^frame=(\d+)$',progress,re.M)[-1]=='48' and re.findall(r'^out_time_us=(\d+)$',progress,re.M)[-1]=='2000000','decode mismatch')
            bad=run('/bin/ffmpeg',common+decode+input_args(fmt)+mapping+['-f','null','pipe:2'],b'not a video')
            require(bad.returncode!=0,'invalid media accepted')
            video.append({'source':fmt,'output':'h264 MP4','frames':48,'durationUs':2000000,'bytes':len(out),'invalidRejected':True})
        summary={'status':'PASS_SCOPED_LINUX_LAB','ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],'launcherSha256':hashlib.sha256(LAUNCHER.read_bytes()).hexdigest(),'runtimeLibraries':len(libs),'probe':probe,'cpuLimit':{'exit':cpu.returncode,'elapsedSeconds':round(elapsed,2)},'unsafeJailRejected':True,'video':video,'scope':'disposable Linux lab only; no production worker, no upload route, no Windows sandbox'}
    with result.open('x') as f: json.dump(summary,f,indent=2);f.write('\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__': main()
