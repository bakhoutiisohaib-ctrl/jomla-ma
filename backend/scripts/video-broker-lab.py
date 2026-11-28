#!/usr/bin/env python3
"""One-job disposable Linux lab supervisor. Root provisioning only; never a web service."""
import hashlib, json, os, selectors, socket, struct, subprocess, sys, time, re, signal, fcntl, select
from pathlib import Path
MAX = 20 * 1024 * 1024
HEADER = 4096
PEER_UID = 61002
COMMON = ['-hide_banner','-v','error','-max_alloc','67108864']
DECODE = ['-nostdin','-xerror','-abort_on','empty_output+empty_output_stream','-threads','1','-max_pixels','2073600','-err_detect','explode']
MAP = ['-map','0:v:0','-an','-sn','-dn']

def require(ok):
    if not ok: raise ValueError('LAB_REJECTED')

def digest(data): return hashlib.sha256(data).hexdigest()
def remaining(deadline):
    value=deadline-time.monotonic(); require(value>0); return value

def receive(conn,n,deadline):
    data=bytearray()
    while len(data)<n:
        conn.settimeout(remaining(deadline)); part=conn.recv(min(65536,n-len(data))); require(part); data.extend(part)
    return bytes(data)

def unique(pairs):
    obj=dict(pairs); require(len(obj)==len(pairs)); return obj

def parse_request(conn,deadline):
    n=struct.unpack('>I',receive(conn,4,deadline))[0]; require(0<n<=HEADER)
    h=json.loads(receive(conn,n,deadline),object_pairs_hook=unique)
    require(isinstance(h,dict) and set(h)=={'version','jobId','mime','bytes','inputSha256'})
    require(type(h['version']) is int and h['version']==1 and isinstance(h['jobId'],str) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',h['jobId']))
    require(h['mime'] in ('video/mp4','video/webm') and type(h['bytes']) is int and 16<=h['bytes']<=MAX)
    b=receive(conn,h['bytes'],deadline); require(h['inputSha256']==digest(b)); return h,b

def run_native(conn,jail,exe,args,data,deadline,limit):
    # Fixed root-provisioned launcher; the native process drops credentials before decoding.
    p=subprocess.Popen([sys.executable,str(Path(__file__).with_name('video-isolation-lab.py')),str(jail),exe,*args],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,start_new_session=True,env={'LANG':'C','LC_ALL':'C'})
    out=bytearray(); pos=0; end=min(deadline,time.monotonic()+12)
    try:
        with selectors.DefaultSelector() as sel:
            for stream,events,kind in [(p.stdin,selectors.EVENT_WRITE,'in'),(p.stdout,selectors.EVENT_READ,'out'),(p.stderr,selectors.EVENT_READ,'err'),(conn,selectors.EVENT_READ,'client')]:
                os.set_blocking(stream.fileno(),False);sel.register(stream,events,kind)
            while any(k.data!='client' for k in sel.get_map().values()):
                events=sel.select(remaining(end)); require(events)
                for key,_ in events:
                    stream=key.fileobj; kind=key.data
                    if kind=='client': raise ValueError('CLIENT_CLOSED_OR_EXTRA_INPUT')
                    if kind=='in':
                        pos+=os.write(stream.fileno(),data[pos:pos+65536])
                        if pos==len(data): sel.unregister(stream);stream.close()
                    else:
                        b=os.read(stream.fileno(),65536)
                        if not b: sel.unregister(stream);stream.close();continue
                        require(kind!='err' and len(out)+len(b)<=limit);out.extend(b)
        require(p.wait(timeout=remaining(end))==0 and pos==len(data)); return bytes(out)
    finally:
        if p.poll() is None:
            os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
        for stream in (p.stdin,p.stdout,p.stderr): stream.close()
        conn.setblocking(True)

def input_args(mime): return ['-protocol_whitelist','pipe','-f','mov' if mime=='video/mp4' else 'matroska']+(['-enable_drefs','0','-use_absolute_path','0'] if mime=='video/mp4' else [])+['-i','pipe:0']

def normalize(conn,jail,h,data,deadline):
    def run(exe,args,b,limit=65536): return run_native(conn,jail,exe,args,b,deadline,limit)
    def probe(b,mime):
        streams=json.loads(run('/bin/ffprobe',COMMON+input_args(mime)+['-show_entries','stream=codec_type,codec_name,width,height','-of','json'],b))['streams'];require(len(streams)==1)
        s=streams[0]; require(s['codec_type']=='video' and s['codec_name'] in (('h264',) if mime=='video/mp4' else ('vp8','vp9')))
        w,ht=s['width'],s['height']; require(all(type(n) is int and 16<=n<=1920 and n%2==0 for n in (w,ht)) and w*ht<=2073600);return s
    def decoded(b,mime):
        text=run('/bin/ffmpeg',COMMON+DECODE+input_args(mime)+MAP+['-progress','pipe:1','-nostats','-f','null','pipe:2'],b).decode('ascii')
        require(text.splitlines()[-1]=='progress=end');frames=int(re.findall(r'^frame=(\d+)$',text,re.M)[-1]);us=int(re.findall(r'^out_time_us=(\d+)$',text,re.M)[-1]);require(0<frames<=3600 and 0<us<=30000000);return frames,us
    probe(data,h['mime']);decoded(data,h['mime'])
    output=run('/bin/ffmpeg',COMMON+['-filter_threads','1','-filter_complex_threads','1']+DECODE+input_args(h['mime'])+MAP+['-map_metadata','-1','-map_chapters','-1','-t','31','-vf','fps=24','-c:v','libx264','-threads','1','-preset','veryfast','-pix_fmt','yuv420p','-crf','24','-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],data,MAX)
    s=probe(output,'video/mp4');frames,us=decoded(output,'video/mp4');require(frames<=720 and abs(us-frames*1000000/24)<=2)
    receipt={'version':1,'jobId':h['jobId'],'inputSha256':h['inputSha256'],'mime':'video/mp4','codec':'h264','fps':24,'frames':frames,'durationUs':us,'width':s['width'],'height':s['height'],'bytes':len(output),'outputSha256':digest(output)}
    meta=json.dumps(receipt,separators=(',',':')).encode();require(len(meta)<=HEADER);return struct.pack('>I',len(meta))+meta+output

def main():
    require(os.geteuid()==0 and len(sys.argv)==3)
    jail=Path(sys.argv[1]).resolve(strict=True); sock=Path(sys.argv[2]);parent=sock.parent
    require(parent.is_absolute() and parent.stat().st_uid==0 and not parent.stat().st_mode&0o022 and not sock.exists())
    # Same jail cannot be used by another lab supervisor simultaneously.
    fd=os.open(jail,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        serve(jail,sock)
    finally: os.close(fd)

def serve(jail,sock):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
        server.bind(str(sock));os.chown(sock,0,PEER_UID);os.chmod(sock,0o660);server.listen(1);server.settimeout(10)
        try:
            conn,_=server.accept()
            with conn:
                pid,uid,gid=struct.unpack('3i',conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));require(uid==PEER_UID and gid==PEER_UID)
                deadline=time.monotonic()+38;h,data=parse_request(conn,deadline);result=normalize(conn,jail,h,data,deadline)
                require(not select.select([conn],[],[],0)[0])
                conn.settimeout(remaining(deadline));conn.sendall(result)
        finally: sock.unlink()

def interrupted(_sig,_frame): raise ValueError('LAB_INTERRUPTED')

if __name__=='__main__':
    signal.signal(signal.SIGTERM,interrupted)
    try: main()
    except Exception: print('LAB_BROKER_REFUSED',file=sys.stderr);sys.exit(1)
