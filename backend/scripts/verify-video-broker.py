#!/usr/bin/env python3
"""Disposable Linux lab only. Root harness, synthetic fixtures, never a production installer."""
import os, sys, tempfile, shutil, subprocess, json, time, socket, struct, hashlib, re
from pathlib import Path
SRC=Path(__file__).resolve().parent
NODE=shutil.which('node')
UID=61002

def require(ok,msg):
    if not ok: raise RuntimeError(msg)

def main():
    require(os.geteuid()==0 and len(sys.argv)==2 and NODE,'root disposable lab and result path required')
    result=Path(sys.argv[1]).resolve();require(not result.exists(),'result exists')
    rows=[]
    with tempfile.TemporaryDirectory(prefix='jomla-broker-',dir='/tmp') as temp:
        p=Path(temp);p.chmod(0o755);jail=p/'jail';(jail/'bin').mkdir(parents=True)
        for name in ['ffmpeg','ffprobe']:
            src=shutil.which(name);require(src,'missing '+name);shutil.copyfile(src,jail/'bin'/name);(jail/'bin'/name).chmod(0o755)
        libs=set()
        for exe in (jail/'bin').iterdir():
            for line in subprocess.check_output(['ldd',str(exe)],text=True).splitlines():
                require('not found' not in line,'missing library');m=re.search(r'(?:=>\s+)?(/\S+)\s+\(',line)
                if m: libs.add(m.group(1))
        for lib in libs:
            dest=jail/lib.lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(lib,dest);dest.chmod(0o755)
        for name in ['video-broker-lab.py','video-isolation-lab.py','video-broker-client-lab.cjs','verify-video-broker.cjs']:
            shutil.copyfile(SRC/name,p/name)
        shutil.copytree(SRC.parent/'services',p/'services')
        def fixture(name,fmt,duration=2,codec=None):
            out=p/name;codec=codec or ('libx264' if fmt=='mp4' else 'libvpx-vp9')
            data=subprocess.check_output(['ffmpeg','-hide_banner','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t',str(duration),'-an','-c:v',codec,'-threads','1']+(['-movflags','+frag_keyframe+empty_moov+default_base_moof'] if fmt=='mp4' else [])+['-f',fmt,'pipe:1']);out.write_bytes(data);return out
        mp4=fixture('sample.mp4','mp4');webm=fixture('sample.webm','webm');long=fixture('long.mp4','mp4',32)
        fake=p/'fake.mp4';fake.write_bytes(b'\x00\x00\x00\x10ftypisom0000\x00\x00\x00\x09moov\x01\x00\x00\x00\x0bmdat\x01\x02\x03')
        sock=p/'worker.sock';broker_cmd=[sys.executable,str(p/'video-broker-lab.py'),str(jail),str(sock)]
        def start():
            b=subprocess.Popen(broker_cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            for _ in range(200):
                if sock.exists() and sock.stat().st_mode&0o777==0o660:return b
                require(b.poll() is None,'broker failed startup');time.sleep(.01)
            b.kill();b.wait();raise RuntimeError('broker startup timeout')
        def finish(b,expect):
            try: out,err=b.communicate(timeout=12)
            except subprocess.TimeoutExpired:b.kill();b.communicate();raise
            require((b.returncode==0)==expect,'broker status '+str(b.returncode)+' '+err.decode(errors='replace'))
            require(not sock.exists(),'socket not cleaned')
            for status in Path('/proc').glob('[0-9]*/status'):
                try: line=next(x for x in status.read_text().splitlines() if x.startswith('Uid:'));require('61001' not in line.split()[1:],'native worker survived')
                except (FileNotFoundError,ProcessLookupError): pass
        for file,mime,ok in [(mp4,'video/mp4',True),(webm,'video/webm',True),(fake,'video/mp4',False),(long,'video/mp4',False)]:
            b=start()
            try:
                r=subprocess.run([NODE,str(p/'verify-video-broker.cjs'),str(sock),str(file),mime,'ok' if ok else 'reject'],user=UID,group=UID,extra_groups=[],capture_output=True,timeout=45)
                require(r.returncode==0,'caller '+r.stderr.decode(errors='replace'));row=json.loads(r.stdout);finish(b,ok);rows.append({'case':file.name,**row})
            finally:
                if b.poll() is None:b.terminate();b.wait(timeout=5)
        # A second broker cannot acquire the same jail while the first is listening.
        b=start(); second=p/'second.sock'
        r=subprocess.run(broker_cmd[:-1]+[str(second)],capture_output=True,timeout=5)
        require(r.returncode!=0 and not second.exists(),'parallel jail owner accepted')
        b.terminate();finish(b,False);rows.append({'case':'concurrent supervisor same jail','rejected':True})
        # Malformed header and hash requests from the authorized lab UID.
        raw='''import socket,sys,struct,json,uuid\ns=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(sys.argv[1]);mode=sys.argv[2];h=json.dumps(dict(version=1,jobId=str(uuid.uuid4()),mime="video/mp4",bytes=16,inputSha256="0"*64)).encode();s.sendall(struct.pack(">I",4097) if mode=="header" else struct.pack(">I",len(h))+h+b"x"*16);assert not s.recv(1)'''
        for mode in ['header','hash']:
            b=start();r=subprocess.run([sys.executable,'-c',raw,str(sock),mode],user=UID,group=UID,extra_groups=[],capture_output=True,timeout=5);require(r.returncode==0,'bad protocol not closed');finish(b,False);rows.append({'case':'invalid '+mode,'rejected':True})
        # The server credential check must reject a different UID even if root can open the socket.
        b=start()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:c.connect(str(sock))
        finish(b,False);rows.append({'case':'foreign peer credentials','rejected':True})
        # A trusted synthetic peer sends a correct frame then disconnects during native processing.
        b=start();code='''import socket,sys,struct,json,hashlib,uuid,time\nfrom pathlib import Path\nb=Path(sys.argv[2]).read_bytes();h=json.dumps(dict(version=1,jobId=str(uuid.uuid4()),mime="video/mp4",bytes=len(b),inputSha256=hashlib.sha256(b).hexdigest())).encode();s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(sys.argv[1]);s.sendall(struct.pack(">I",len(h))+h+b);time.sleep(20)'''
        c=subprocess.Popen([sys.executable,'-c',code,str(sock),str(long)],user=UID,group=UID,extra_groups=[])
        pid=None
        try:
            for _ in range(1000):
                for st in Path('/proc').glob('[0-9]*/status'):
                    try:
                        info=st.read_text()
                        if re.search(r'^PPid:\s+'+str(b.pid)+r'$',info,re.M) and re.search(r'^Uid:\s+61001\s',info,re.M):pid=int(st.parent.name);break
                    except (FileNotFoundError,ProcessLookupError):pass
                if pid is not None:break
                require(b.poll() is None,'broker exited before cancellation');time.sleep(.002)
            require(pid is not None,'native child not observed');c.kill();c.wait();finish(b,False);require(not Path('/proc',str(pid)).exists(),'cancelled process survived');rows.append({'case':'client disconnect during native job','rejected':True,'nativeChildReaped':True})
        finally:
            if c.poll() is None:c.kill();c.wait()
            if b.poll() is None:b.terminate();b.wait(timeout=5)
        summary={'status':'PASS_SCOPED_LAB','cases':rows,'ffmpeg':subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0],'sourceHashes':{n:hashlib.sha256((SRC.parent/n if n.startswith('services/') else SRC/n).read_bytes()).hexdigest() for n in ['video-broker-lab.py','video-broker-client-lab.cjs','verify-video-broker.cjs','verify-video-broker.py','video-isolation-lab.py','services/videoWorkerLab.js','services/videoContainer.js']},'scope':'one-shot root lab supervisor, non-root caller, no production or customer upload'}
    with result.open('x') as f:json.dump(summary,f,indent=2);f.write('\n')
    print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
