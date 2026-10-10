"""Hidden 1080p Electron integration test with an isolated synthetic WebSocket gateway."""
import json
import os
from pathlib import Path
import struct
import subprocess
import threading
import time
import uuid
import numpy as np
from device_gateway.websocket_server import LocalWebSocketGateway

class SyntheticController:
    def __init__(self,root):self.root=root;self.running=False;self.first=0;self.seq=0;self.markers=[];self.decisions=[];self.thread=None
    def get_status(self):return {'deviceState':'acquiring' if self.running else 'idle'}
    def get_device_properties(self):return {'sample_rate_hz':250,'channel_count':4,'lead_names':['P3','P4','Oz','Pz'],'samples_per_packet':25}
    def control(self):
        try:return json.loads((self.root/'test-control.json').read_text())
        except (FileNotFoundError,ValueError):return {}
    def start_acquisition(self,session_id,on_binary):
        self.sid=session_id;self.first=0;self.seq=0;self.running=True;self.began=time.monotonic()
        def loop():
            while self.running:
                config=self.control()
                if config.get('gap'):self.seq+=1
                t=np.arange(self.first,self.first+25)/250
                data=(10000+12*np.sin(2*np.pi*12*t[:,None])+np.array([0,.2,.4,.6])).astype('<f4')
                header=struct.pack('<4sHH16sQQQIHHI',b'BGEE',1,1,uuid.UUID(self.sid).bytes,self.seq,self.first,time.monotonic_ns(),250,4,25,0)
                on_binary(header+data.tobytes());self.first+=25;self.seq+=1
                time.sleep(max(0,self.began+self.first/250-time.monotonic()))
        self.thread=threading.Thread(target=loop,daemon=True);self.thread.start();return 'sent'
    def stop_acquisition(self):
        self.running=False
        if self.thread:self.thread.join(1)
        return 'device_status'
    def stimulus_marker(self,marker):
        if self.control().get('failStart') and marker.get('markerType')=='stimulus_start':raise ValueError('injected marker failure')
        index=round((time.monotonic()-self.began)*250);self.markers.append({**marker,'markerSampleIndex':index})
        return {'markerSampleIndex':str(index),'gatewayMonotonicNs':time.monotonic_ns()}
    def bci_decision(self,decision):self.decisions.append(decision)
    def calibration_model(self,model):raise ValueError('No personal calibration in experiment protocol')
    def disconnect(self):self.stop_acquisition()
    def shutdown(self):self.stop_acquisition()

def main():
    # Unique directory avoids an earlier experiment or a real account's userData.
    root=Path('.smoke-user-data')/('lab-desktop-'+str(uuid.uuid4()));root.mkdir(parents=True)
    controller=SyntheticController(root);server=LocalWebSocketGateway(controller,token='isolated-lab-test')
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    connection=root/'test-connection.json';connection.write_text(json.dumps({'url':server.url,'token':server.token,'protocolVersion':1}))
    env={**os.environ,'BRAIN_GAME_LAB_UI_CHECK':'1','BRAIN_GAME_SMOKE_USER_DATA':str(root.resolve()),'BRAIN_GAME_LAB_TEST_CONNECTION':str(connection.resolve())}
    executable=Path('node_modules/electron/dist/electron.exe').resolve()
    try:
        process=subprocess.run([str(executable),'.'],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=150)
        (root/'electron.log').write_text(process.stdout+'\n'+process.stderr,encoding='utf-8')
        print(process.stdout)
        if process.returncode or 'LAB_ACQUISITION_CHECK=' not in process.stdout:raise AssertionError(process.stderr)
        results=json.loads((root/'lab-acquisition-check.json').read_text());attempts=results['attempts']
        if len(set(a['trialId'] for a in attempts))!=len(attempts):raise AssertionError('Attempt ids reused')
        starts=[m for m in controller.markers if m.get('markerType')=='stimulus_start'];ends=[m for m in controller.markers if m.get('markerType')=='stimulus_end']
        complete=[m for m in ends if m.get('endReason')=='lab_complete']
        if len(complete)!=1:raise AssertionError('Unexpected completed trials')
        start=next(m for m in starts if m['trialId']==complete[0]['trialId'])
        if abs(complete[0]['markerSampleIndex']-start['markerSampleIndex']-2500)>25:raise AssertionError('Markers not aligned with 10-second EEG')
        if len([m for m in controller.markers if m.get('markerType')=='lab_baseline_start'])!=1:raise AssertionError('Session baseline did not run exactly once')
        (root/'synthetic-markers.json').write_text(json.dumps(controller.markers,ensure_ascii=False,indent=2),encoding='utf-8')
        print('DESKTOP_TEST_PASSED='+str(root.resolve()))
    finally:controller.shutdown();server.shutdown();server.server_close();thread.join(1)

if __name__=='__main__':main()
